import { EventEmitter } from "node:events";
import { query } from "@anthropic-ai/claude-code";
import type { Role } from "../types.js";
import type { Logger } from "../utils/logger.js";
import {
	type DriverCommand,
	MockToolParser,
} from "../utils/navigatorCommands.js";
import { AsyncUserMessageStream } from "../utils/streamInput.js";

/**
 * Driver agent - implements the plan with navigator feedback
 */
type UnknownRecord = Record<string, unknown>;

export class Driver extends EventEmitter {
	private sessionId: string | null = null;
	private inputStream?: AsyncUserMessageStream;
	// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK query iterator type
	private queryIterator: AsyncGenerator<any, void> | null = null;
	private processingLoopStarted = false;
	private batchResolvers: Array<(msgs: string[]) => void> = [];
	private pendingTexts: string[] = [];
	private pendingTools: Set<string> = new Set();
	private pendingToolWaiters: Array<() => void> = [];

	// Optional canUseTool callback for permission-mode gating (SDK dynamic shapes)
	private canUseTool?: (
		toolName: string,
		input: UnknownRecord,
		options?: { signal?: AbortSignal; suggestions?: UnknownRecord },
	) => Promise<
		| {
				behavior: "allow";
				updatedInput: UnknownRecord;
				updatedPermissions?: UnknownRecord;
		  }
		| { behavior: "deny"; message: string; interrupt?: boolean }
	>;

	constructor(
		private systemPrompt: string,
		private allowedTools: string[],
		private maxTurns: number,
		private projectPath: string,
		private logger: Logger,
		_canUseTool?: (
			toolName: string,
			input: UnknownRecord,
		) => Promise<
			| {
					behavior: "allow";
					updatedInput: UnknownRecord;
					updatedPermissions?: UnknownRecord;
			  }
			| { behavior: "deny"; message: string; interrupt?: boolean }
		>,
	) {
		super();
		this.canUseTool = _canUseTool;
	}

	/**
	 * Start implementation with the given plan
	 */
	async startImplementation(plan: string): Promise<string[]> {
		this.logger.logEvent("DRIVER_STARTING_IMPLEMENTATION", {
			planLength: plan.length,
			maxTurns: this.maxTurns,
		});

		const implementMessage = `I have written this plan for you to implement:\n\n${plan}\n\nPlease start implementing this step by step - I will be monitoring and providing feedback as we go.`;

		try {
			await this.ensureStreamingQuery();
			await this.waitForNoPendingTools();
			this.inputStream?.pushText(implementMessage);
			const batch = await this.waitForBatch();
			return batch;
		} catch (error) {
			this.logger.logEvent("DRIVER_IMPLEMENTATION_ERROR", {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * Continue implementation with navigator feedback
	 */
	async continueWithFeedback(feedback: string): Promise<string[]> {
		if (!this.sessionId) {
			throw new Error("Driver not started - call startImplementation() first");
		}

		this.logger.logEvent("DRIVER_CONTINUING_WITH_FEEDBACK", {
			feedbackLength: feedback.length,
			sessionId: this.sessionId,
		});

		try {
			// Resume session with navigator feedback
			await this.ensureStreamingQuery();
			await this.waitForNoPendingTools();
			const feedbackMessage = feedback;
			this.inputStream?.pushText(feedbackMessage);
			const batch = await this.waitForBatch();
			return batch;
		} catch (error) {
			this.logger.logEvent("DRIVER_FEEDBACK_ERROR", {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * Check if messages contain a RequestReview command
	 */
	static hasRequestReview(messages: string[]): DriverCommand | null {
		const combinedMessage = messages.join("\n");
		return MockToolParser.parseDriverMessage(combinedMessage);
	}

	/**
	 * Combine messages for sending to navigator
	 */
	static combineMessagesForNavigator(messages: string[]): string {
		if (messages.length === 0) return "";

		if (messages.length === 1) {
			return messages[0];
		}

		return messages.map((msg) => `\n${msg}`).join("\n\n");
	}

	/**
	 * Get session ID
	 */
	getSessionId(): string | null {
		return this.sessionId;
	}

	private static generateMessageId(): string {
		const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
		const ts = Date.now().toString(36).slice(-2).toUpperCase();
		return `${ts}${rand}`; // short, human-friendly
	}

	private async ensureStreamingQuery() {
		if (this.queryIterator) return;
		const toolsToPass =
			this.allowedTools[0] === "all" ? undefined : this.allowedTools;
		this.inputStream = new AsyncUserMessageStream();
		this.queryIterator = query({
			// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK prompt interface expects AsyncIterable
			prompt: this.inputStream as any,
			options: {
				cwd: this.projectPath,
				appendSystemPrompt: this.systemPrompt,
				allowedTools: toolsToPass,
				permissionMode: "default",
				maxTurns: this.maxTurns,
				includePartialMessages: true,
				// biome-ignore lint/suspicious/noExplicitAny: CanUseTool function signature provided by SDK
				canUseTool: this.canUseTool as any,
			},
			// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK query return type
		}) as any;

		if (!this.processingLoopStarted) {
			this.processingLoopStarted = true;
			this.processMessages();
		}
	}

	private async processMessages() {
		try {
			// biome-ignore lint/style/noNonNullAssertion: queryIterator is guaranteed to exist after ensureStreamingQuery
			for await (const message of this.queryIterator!) {
				if (message.type === "system") {
					// Forward system notifications (e.g., turn_limit_reached, conversation_ended)
					try {
						// biome-ignore lint/suspicious/noExplicitAny: SDK system message subtype
						const subtype = (message as any).subtype || "";
						this.logger.logEvent("DRIVER_SYSTEM_MESSAGE", { subtype });
						this.emit("system", { subtype });
						if (
							subtype === "turn_limit_reached" ||
							subtype === "conversation_ended"
						) {
							// Clear iterator so next prompt will re-initialize the session
							// biome-ignore lint/suspicious/noExplicitAny: internals
							(this.queryIterator as any) = null;
							this.processingLoopStarted = false;
						}
					} catch {}
					continue;
				}
				if (message.session_id) {
					if (!this.sessionId) {
						this.sessionId = message.session_id;
						this.logger.logEvent("DRIVER_SESSION_CAPTURED", {
							sessionId: this.sessionId,
						});
					} else if (this.sessionId !== message.session_id) {
						this.logger.logEvent("DRIVER_SESSION_MISMATCH", {
							previous: this.sessionId,
							received: message.session_id,
						});
						this.sessionId = message.session_id;
					}
				}

				if (message.type === "assistant" && message.message?.content) {
					const content = message.message.content;
					if (Array.isArray(content)) {
						let uiText = "";
						let fwdText = "";
						const modifiedFiles: string[] = [];
						let lastBashCmd: string | undefined;
						for (const item of content) {
							if (item.type === "text") {
								uiText += `${item.text}\n`;
								fwdText += `${item.text}\n`;
							} else if (item.type === "tool_use") {
								this.emit("tool_use", {
									role: "driver" as Role,
									tool: item.name,
									input: item.input,
								});
								// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK tool_use item structure
								const toolUseId = (item as any).id || (item as any).tool_use_id;
								if (toolUseId) {
									this.pendingTools.add(toolUseId);
									this.logger.logEvent("DRIVER_TOOL_PENDING", {
										id: toolUseId,
										tool: item.name,
									});
								}
								if (
									item.name === "Write" ||
									item.name === "Edit" ||
									item.name === "MultiEdit"
								) {
									const fileName = item.input?.file_path || "file";
									this.logger.logEvent("DRIVER_FILE_MODIFIED", {
										tool: item.name,
										file: fileName,
									});
									if (
										item.input?.file_path &&
										!modifiedFiles.includes(item.input.file_path)
									) {
										modifiedFiles.push(item.input.file_path);
									}
								}
								if (item.name === "Bash" && item.input?.command) {
									lastBashCmd = String(item.input.command);
								}
								// Include a concise tool summary in the text forwarded to navigator
								const file = item.input?.file_path || item.input?.path || "";
								const cmd = item.input?.command || "";
								const toolLine =
									item.name === "Bash" && cmd
										? `⚙️  Tool: Bash - ${String(cmd)}`
										: file
											? `⚙️  Tool: ${item.name} - ${file}`
											: `⚙️  Tool: ${item.name}`;
								fwdText += `${toolLine}\n`;
							}
						}
						// Debounced verification hints once per batch (only in forwarded text)
						if (modifiedFiles.length > 0) {
							const filesList = modifiedFiles.join(", ");
							const diffHint =
								modifiedFiles.length === 1
									? `git diff -- ${modifiedFiles[0]}`
									: `git diff`;
							fwdText += `🔎 Verify: Read ${filesList} (optionally: Bash '${diffHint}')\n`;
						}
						if (lastBashCmd) {
							fwdText += `🔧 Tip: If the command failed, inspect output or run manually: ${lastBashCmd}\n`;
						}
						const consolidatedUI = uiText.trim();
						const consolidatedFwd = fwdText.trim();
						if (consolidatedUI || consolidatedFwd) {
							const id = Driver.generateMessageId();
							if (consolidatedUI) {
								this.emit("message", {
									role: "assistant",
									content: consolidatedUI,
									sessionRole: "driver" as Role,
									timestamp: new Date(),
									id,
								});
							}
							let toForward = consolidatedFwd || consolidatedUI;
							if (toForward) {
								// Add a small directive to encourage verification on the navigator side when edits occurred
								if (modifiedFiles.length > 0) {
									const filesList = modifiedFiles.join(", ");
									toForward += `\n[VERIFY] Read ${filesList} then respond with {{Nod message_id="${id}" comment="verified ${filesList}"}}`;
								}
								this.pendingTexts.push(
									`[[MSG id=${id}]]\n${toForward}\n[[END_MSG]]`,
								);
							}
						}
					}
				} else if (
					message.type === "user" &&
					// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK user message structure
					(message as any).message?.content
				) {
					// Scan for tool_result blocks to clear pending tool_use ids
					// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK user message content
					const ucontent = (message as any).message.content;
					if (Array.isArray(ucontent)) {
						for (const item of ucontent) {
							if (item.type === "tool_result") {
								// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK tool_result item structure
								const tid = (item as any).tool_use_id;
								if (tid && this.pendingTools.has(tid)) {
									this.pendingTools.delete(tid);
									this.logger.logEvent("DRIVER_TOOL_RESULT_OBSERVED", {
										id: tid,
									});
								}
							}
						}
						if (this.pendingTools.size === 0) {
							this.resolvePendingToolWaiters();
							// Send intermediate batch when all tools complete to improve navigator responsiveness
							if (this.pendingTexts.length > 0) {
								const batch = this.pendingTexts.slice();
								this.pendingTexts = [];
								const resolver = this.batchResolvers.shift();
								if (resolver) {
									resolver(batch);
									this.logger.logEvent("DRIVER_INTERMEDIATE_BATCH", {
										messageCount: batch.length,
									});
								}
							}
						}
					}
				} else if (message.type === "result") {
					const batch = this.pendingTexts.slice();
					this.pendingTexts = [];
					const resolver = this.batchResolvers.shift();
					if (resolver) resolver(batch);
					this.logger.logEvent("DRIVER_BATCH_RESULT", {
						messageCount: batch.length,
					});
					// Emit a lightweight signal for UI/status updates
					try {
						this.emit("batch_result", { count: batch.length });
					} catch {}
				}
			}
		} catch (err) {
			this.logger.logEvent("DRIVER_PROCESS_LOOP_ERROR", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	private waitForBatch(): Promise<string[]> {
		return new Promise((resolve) => {
			this.batchResolvers.push(resolve);
		});
	}

	private resolvePendingToolWaiters() {
		if (this.pendingTools.size === 0 && this.pendingToolWaiters.length) {
			const waiters = this.pendingToolWaiters.slice();
			this.pendingToolWaiters = [];
			waiters.forEach((w) => {
				w();
			});
		}
	}

	private waitForNoPendingTools(timeoutMs = 15000): Promise<void> {
		if (this.pendingTools.size === 0) return Promise.resolve();
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.logger.logEvent("DRIVER_PENDING_TOOL_TIMEOUT", {
					pendingCount: this.pendingTools.size,
					ids: Array.from(this.pendingTools),
				});
				resolve();
			}, timeoutMs);
			this.pendingToolWaiters.push(() => {
				clearTimeout(timer);
				resolve();
			});
		});
	}

	public async stop(): Promise<void> {
		try {
			// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK query interrupt method
			if (this.queryIterator && (this.queryIterator as any).interrupt) {
				// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK query interrupt method
				await (this.queryIterator as any).interrupt();
			}
			this.inputStream?.end();
		} catch {}
	}

	/**
	 * Push navigator feedback directly into the driver session without waiting for a batch.
	 * Useful for permission decisions so the model knows why access was denied/approved.
	 */
	public pushNavigatorFeedback(text: string): void {
		if (!text || !this.inputStream) return;
		const feedbackMessage = text;
		try {
			this.inputStream.pushText(feedbackMessage);
			this.logger.logEvent("DRIVER_NAVIGATOR_FEEDBACK_PUSHED", {
				length: text.length,
			});
		} catch (err) {
			this.logger.logEvent("DRIVER_NAVIGATOR_FEEDBACK_PUSH_ERROR", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
}
