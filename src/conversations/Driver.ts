import { EventEmitter } from "node:events";
import type {
	AgentInputStream,
	EmbeddedAgentProvider,
	StreamingAgentSession,
} from "../providers/types.js";
import { isAllToolsEnabled, isFileModificationTool } from "../types/core.js";
import type { DriverCommand, Role } from "../types.js";
import type { Logger } from "../utils/logger.js";
import { DRIVER_TOOL_NAMES, driverMcpServer } from "../utils/mcpServers.js";
import { TIMEOUT_CONFIG, TimeoutManager } from "../utils/timeouts.js";

/**
 * Driver agent - implements the plan with navigator reviews
 */
type UnknownRecord = Record<string, unknown>;

export class Driver extends EventEmitter {
	private sessionId: string | null = null;
	private inputStream?: AgentInputStream;
	private streamingSession: StreamingAgentSession | null = null;
	private processingLoopStarted = false;
	private batchResolvers: Array<(msgs: string[]) => void> = [];
	private pendingTexts: string[] = [];
	private pendingTools: Set<string> = new Set();
	private pendingToolWaiters: Array<() => void> = [];
	private driverCommands: DriverCommand[] = [];
	private toolResults: Map<string, any> = new Map();

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
		| { behavior: "deny"; message: string }
	>;

	constructor(
		private systemPrompt: string,
		private allowedTools: string[],
		private maxTurns: number,
		private projectPath: string,
		private logger: Logger,
		private provider: EmbeddedAgentProvider,
		_canUseTool?: (
			toolName: string,
			input: UnknownRecord,
		) => Promise<
			| {
					behavior: "allow";
					updatedInput: UnknownRecord;
					updatedPermissions?: UnknownRecord;
			  }
			| { behavior: "deny"; message: string }
		>,
		private mcpServerUrl?: string,
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

		const implementMessage = `I have written this plan for you to implement:\n\n${plan}\n\nPlease start implementing this step by step.`;

		try {
			await this.ensureStreamingQuery();
			await this.waitForNoPendingTools();
			this.inputStream?.pushText(implementMessage);
			const batch = await this.waitForBatch();
			return batch;
		} catch (error) {
			if (
				error instanceof Error &&
				error.message.includes("Tool results timed out")
			) {
				this.logger.logEvent("DRIVER_TOOL_TIMEOUT_RECOVERY", {
					error: error.message,
				});
				// Session is now interrupted and will need to be restarted
				throw new Error("Driver session interrupted due to tool timeout");
			}
			this.logger.logEvent("DRIVER_IMPLEMENTATION_ERROR", {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * Continue implementation with prompt
	 */
	async continueWithFeedback(prompt: string): Promise<string[]> {
		if (!this.sessionId) {
			throw new Error("Driver not started - call startImplementation() first");
		}

		this.logger.logEvent("DRIVER_CONTINUING_WITH_PROMPT", {
			promptLength: prompt.length,
			sessionId: this.sessionId,
		});

		try {
			// Resume session with prompt
			await this.ensureStreamingQuery();
			await this.waitForNoPendingTools();
			this.inputStream?.pushText(prompt);
			const batch = await this.waitForBatch();
			return batch;
		} catch (error) {
			if (
				error instanceof Error &&
				error.message.includes("Tool results timed out")
			) {
				this.logger.logEvent("DRIVER_TOOL_TIMEOUT_RECOVERY", {
					error: error.message,
				});
				throw new Error("Driver session interrupted due to tool timeout");
			}
			this.logger.logEvent("DRIVER_FEEDBACK_ERROR", {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * Check if messages contain a RequestReview command (now handled via MCP tools)
	 * This method will be updated by the orchestration logic to work with MCP tool events
	 */
	static hasRequestReview(_messages: string[]): DriverCommand | null {
		// This will be replaced by MCP tool event detection in the orchestration layer
		// For now, return null since MCP tools handle this communication
		return null;
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
		if (this.streamingSession) return;

		// Create streaming session using provider
		this.streamingSession = this.provider.createStreamingSession({
			systemPrompt: this.systemPrompt,
			allowedTools: this.allowedTools,
			additionalMcpTools: DRIVER_TOOL_NAMES,
			maxTurns: this.maxTurns,
			projectPath: this.projectPath,
			mcpServerUrl: this.mcpServerUrl,
			embeddedMcpServer: driverMcpServer,
			mcpRole: "driver",
			canUseTool: this.canUseTool,
			disallowedTools: [],
			includePartialMessages: true,
		});

		// Use the session's input stream
		this.inputStream = this.streamingSession.inputStream;

		// Log session creation
		try {
			this.logger.logEvent("DRIVER_QUERY_INIT", {
				allowedTools: isAllToolsEnabled(this.allowedTools)
					? "all"
					: this.allowedTools,
				mcpServerUrl: this.mcpServerUrl || "embedded",
				maxTurns: this.maxTurns,
				hasSystemPrompt: !!this.systemPrompt,
			});
		} catch {}

		if (!this.processingLoopStarted) {
			this.processingLoopStarted = true;
			this.processMessages();
		}
	}

	private async processMessages() {
		try {
			// biome-ignore lint/style/noNonNullAssertion: streamingSession is guaranteed to exist after ensureStreamingQuery
			for await (const message of this.streamingSession!) {
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
							// Clear session so next prompt will re-initialize
							this.streamingSession = null;
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

									// Store MCP tool results for driver communication
									if (!item.name) {
										this.logger.logEvent("DRIVER_TOOL_MISSING_NAME", {
											item: JSON.stringify(item),
										});
										console.warn("Driver: tool_use item missing name:", item);
									} else if (item.name.startsWith("mcp__driver__")) {
										this.toolResults.set(toolUseId, {
											toolName: item.name,
											input: item.input,
										});
									}
								}
								if (item.name && isFileModificationTool(item.name)) {
									const fileName = item.input?.file_path || "file";
									this.logger.logEvent("DRIVER_FILE_MODIFIED", {
										tool: item.name,
										file: fileName,
									});
									const filePath = item.input?.file_path;
									if (
										filePath &&
										typeof filePath === "string" &&
										!modifiedFiles.includes(filePath)
									) {
										modifiedFiles.push(filePath);
									}
								}
								if (item.name === "Bash" && item.input?.command) {
									lastBashCmd = String(item.input.command);
								}
								// Include tool summary in forwarded text (except already approved edit tools)
								const isApprovedEditTool =
									item.name === "Write" ||
									item.name === "Edit" ||
									item.name === "MultiEdit";

								if (!isApprovedEditTool) {
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
							const toForward = consolidatedFwd || consolidatedUI;
							if (toForward) {
								// Add latest driver message for nav.
								this.pendingTexts.push(`${toForward}\n`);
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
								// Log tool_result errors (e.g., missing tools)
								try {
									const anyItem: any = item as any;
									const isErr = (anyItem.is_error ?? anyItem.isError) === true;
									let errText: string | undefined =
										typeof anyItem.text === "string" ? anyItem.text : undefined;
									if (!errText && Array.isArray(anyItem.content)) {
										const firstText = anyItem.content.find(
											(c: any) =>
												c?.type === "text" && typeof c.text === "string",
										);
										if (firstText) errText = firstText.text;
									}
									if (
										isErr ||
										(errText &&
											/no such tool available|session not found/i.test(errText))
									) {
										this.logger.logEvent("DRIVER_TOOL_RESULT_ERROR", {
											isError: isErr,
											text: errText,
											tool_use_id: anyItem.tool_use_id,
										});
									}
								} catch {}
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

							// Process MCP driver commands when tools complete
							this.processDriverCommands();

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
					// Process MCP driver commands on final result
					this.processDriverCommands();

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

	private waitForNoPendingTools(
		timeoutMs = TIMEOUT_CONFIG.TOOL_COMPLETION,
	): Promise<void> {
		return TimeoutManager.createWaiterTimeout(
			() => this.pendingTools.size === 0,
			async () => {
				this.logger.logEvent("DRIVER_PENDING_TOOL_TIMEOUT", {
					pendingCount: this.pendingTools.size,
					ids: Array.from(this.pendingTools),
				});
				// Interrupt the session to prevent malformed message streams
				try {
					if (this.streamingSession?.interrupt) {
						await this.streamingSession.interrupt();
					}
				} catch (error) {
					this.logger.logEvent("DRIVER_SESSION_INTERRUPT_ERROR", {
						error: error instanceof Error ? error.message : String(error),
					});
				}
				throw new Error(
					`Tool results timed out after ${timeoutMs}ms. Pending tools: ${Array.from(this.pendingTools).join(", ")}`,
				);
			},
			timeoutMs,
			(callback) => this.pendingToolWaiters.push(callback),
		);
	}

	/**
	 * Process MCP driver commands from tool results
	 */
	private processDriverCommands(): void {
		for (const [toolId, toolData] of this.toolResults) {
			if (this.pendingTools.has(toolId)) continue; // Wait for tool_result

			const cmd = this.convertMcpToolToDriverCommand(
				toolData.toolName,
				toolData.input,
			);
			if (cmd) {
				this.driverCommands.push(cmd);
				this.logger.logEvent("DRIVER_MCP_COMMAND", {
					type: cmd.type,
					context: cmd.context,
				});
			}
		}
		// Clear processed tool results
		for (const toolId of this.toolResults.keys()) {
			if (!this.pendingTools.has(toolId)) {
				this.toolResults.delete(toolId);
			}
		}
	}

	/**
	 * Convert MCP tool call to DriverCommand
	 */
	private convertMcpToolToDriverCommand(
		toolName: string,
		input: any,
	): DriverCommand | null {
		switch (toolName) {
			case "mcp__driver__driverRequestReview":
				return {
					type: "request_review",
					context: input.context,
				};
			case "mcp__driver__driverRequestGuidance":
				return {
					type: "request_guidance",
					context: input.context,
				};
			default:
				return null;
		}
	}

	/**
	 * Get and clear any pending driver commands (for orchestration layer)
	 */
	public getAndClearDriverCommands(): DriverCommand[] {
		const commands = this.driverCommands.slice();
		this.driverCommands = [];
		return commands;
	}

	public async stop(): Promise<void> {
		try {
			if (this.streamingSession?.interrupt) {
				await this.streamingSession.interrupt();
			}
			// Note: inputStream is managed by the streamingSession, no need to end it separately
		} catch {}
	}

	// Expose pending tool state to orchestrator
	public hasPendingTools(): boolean {
		return this.pendingTools.size > 0;
	}
}
