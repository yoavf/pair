import { EventEmitter } from "node:events";
import { query } from "@anthropic-ai/claude-code";
import type { Role } from "../types.js";
import type { Logger } from "../utils/logger.js";
import {
	MockToolParser,
	type NavigatorCommand,
} from "../utils/navigatorCommands.js";
import { AsyncUserMessageStream } from "../utils/streamInput.js";

/**
 * Navigator agent - monitors driver implementation and provides feedback
 */
export class Navigator extends EventEmitter {
	private sessionId: string | null = null;
	private inputStream?: AsyncUserMessageStream;
	// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK query type
	private queryIterator: any = null;
	private processingLoopStarted = false;
	private batchResolvers: Array<(cmds: NavigatorCommand[]) => void> = [];
	private pendingFullText: string[] = [];
	private pendingTools: Set<string> = new Set();
	private pendingToolWaiters: Array<() => void> = [];
	private permissionResolvers: Array<(text: string) => void> = [];

	constructor(
		private systemPrompt: string,
		private allowedTools: string[],
		private maxTurns: number,
		private projectPath: string,
		private logger: Logger,
	) {
		super();
	}

	/**
	 * Initialize navigator session with plan context
	 */
	async initialize(originalTask: string, plan: string): Promise<void> {
		this.logger.logEvent("NAVIGATOR_INITIALIZING", {
			taskLength: originalTask.length,
			planLength: plan.length,
		});

		// Store context for use in first processDriverMessage call
		this.originalTask = originalTask;
		this.plan = plan;

		this.logger.logEvent("NAVIGATOR_INITIALIZED", {
			contextStored: true,
		});
	}

	private originalTask?: string;
	private plan?: string;

	/**
	 * Process driver message and provide feedback
	 */
	async processDriverMessage(
		driverMessage: string,
	): Promise<NavigatorCommand[] | null> {
		this.logger.logEvent("NAVIGATOR_PROCESSING_DRIVER_MESSAGE", {
			messageLength: driverMessage.length,
			sessionId: this.sessionId,
			isFirstMessage: !this.sessionId,
		});

		const _navigatorCommand: NavigatorCommand | null = null;

		try {
			const _toolsToPass =
				this.allowedTools[0] === "all" ? undefined : this.allowedTools;
			// Ensure a single streaming session
			await this.ensureStreamingQuery();

			if (!this.sessionId) {
				const prompt = `[CONTEXT REMINDER] You are the navigator. You just finished planning our work.

This is YOUR plan for "${this.originalTask}":

${this.plan}

I am now requesting a review of my implementation progress below. Evaluate and respond with exactly one tag:
- {{CodeReview comment="assessment" pass="true|false"}}
- {{Complete summary="what was accomplished"}}  (only if pass=true and the task is truly complete)

Here is my update for review: ${driverMessage}

STRICT OUTPUT: EXACTLY ONE tag from the list above. No prose outside the tag.`;
				await this.waitForNoPendingTools();
				this.inputStream?.pushText(prompt);
			} else {
				const prompt = `${driverMessage}\n\nSTRICT OUTPUT: EXACTLY ONE tag: {{CodeReview ...}} | {{Complete ...}}. No prose outside the tag.`;
				await this.waitForNoPendingTools();
				this.inputStream?.pushText(prompt);
			}
			// Wait for end-of-batch to avoid losing later commands (e.g., CodeReview pass)
			const cmds = await this.waitForBatchCommands();
			return cmds && cmds.length > 0 ? cmds : null;
		} catch (error) {
			this.logger.logEvent("NAVIGATOR_PROCESSING_ERROR", {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * Extract feedback content for driver from navigator command
	 */
	static extractFeedbackForDriver(command: NavigatorCommand): string | null {
		if (command.type === "code_review" && command.pass === false) {
			return (
				command.comment || "Please address the review feedback and continue."
			);
		}
		return null;
	}

	/**
	 * Check if command indicates session should end
	 */
	static shouldEndSession(command: NavigatorCommand): boolean {
		if (command.type === "complete") return true;
		if (command.type === "code_review" && command.pass === true) return true;
		return false;
	}

	/**
	 * Get session ID
	 */
	getSessionId(): string | null {
		return this.sessionId;
	}

	private async ensureStreamingQuery() {
		if (this.queryIterator) return;
		const toolsToPass =
			this.allowedTools[0] === "all" ? undefined : this.allowedTools;
		this.inputStream = new AsyncUserMessageStream();
		this.queryIterator = query({
			prompt: this.inputStream,
			options: {
				cwd: this.projectPath,
				appendSystemPrompt: this.systemPrompt,
				allowedTools: toolsToPass,
				permissionMode: "default",
				maxTurns: this.maxTurns,
				includePartialMessages: true,
			},
		});

		if (!this.processingLoopStarted) {
			this.processingLoopStarted = true;
			this.processMessages();
		}
	}

	/**
	 * Review a permission request for a tool use and return a single decision.
	 * This spins up a short-lived query dedicated to this approval.
	 */
	public async reviewPermission(
		driverTranscript: string,
		toolName: string,
		input: Record<string, unknown>,
	): Promise<{
		allow: boolean;
		alwaysAllow?: boolean;
		updatedInput: Record<string, unknown>;
		comment?: string; // decision note
		feedback?: string; // optional actionable guidance
	}> {
		// Build a strict prompt: exactly one decision tag; optionally one feedback tag
		const toolDetails = `Tool: ${toolName}\nInput: ${JSON.stringify(input, null, 2)}`;
		const strict = `I ask that you review a request for making an edit.\n\nMy actions transcript (since last approval):\n${driverTranscript}\n\n${toolDetails}\n\nRespond with EXACTLY ONE decision tag, and optionally ONE feedback tag.\n\nDecision (choose exactly one):\n- {{Approve comment="short reason"}}\n- {{ApproveAlways comment="short reason"}}\n- {{Deny comment="short reason"}}\n\nOptional feedback (at most one, only if specific and helpful):\n- {{Feedback comment="one short actionable suggestion"}}`;

		let merged = "";
		try {
			await this.ensureStreamingQuery();
			this.inputStream?.pushText(strict);
			merged = await new Promise<string>((resolve) => {
				this.permissionResolvers.push(resolve);
			});
		} catch (err) {
			this.logger.logEvent("NAVIGATOR_PERMISSION_REVIEW_ERROR", {
				error: err instanceof Error ? err.message : String(err),
			});
		}

		// Map CodeReview (pass=true/false) to Approve/Deny as a fallback
		const codeReview = Navigator.parseOptionalCodeReview(merged);
		let decision = Navigator.parseApprovalTag(merged);
		const feedback = Navigator.parseOptionalFeedback(merged);
		if (!decision && codeReview) {
			decision = codeReview.pass
				? { type: "approve", comment: codeReview.comment }
				: { type: "deny", comment: codeReview.comment };
		}

		// Emit a friendly, non-tag display line summarizing the decision
		try {
			const displayText = !decision
				? "⚠️ Permission decision not recognized"
				: decision.type === "deny"
					? `⛔ Permission denied: ${decision.comment || "no reason provided"}`
					: decision.type === "approve_always"
						? `✅ Permission approved (always): ${decision.comment || ""}`
						: `✅ Permission approved: ${decision.comment || ""}`;
			this.emit("message", {
				role: "assistant",
				content: displayText,
				sessionRole: "navigator" as Role,
				timestamp: new Date(),
			});
			if (feedback && feedback.trim().length > 0) {
				this.emit("message", {
					role: "assistant",
					content: `💡 Feedback: ${feedback.trim()}`,
					sessionRole: "navigator" as Role,
					timestamp: new Date(),
				});
			}
		} catch {}

		return {
			allow:
				decision?.type === "approve" || decision?.type === "approve_always",
			alwaysAllow: decision?.type === "approve_always",
			updatedInput: input,
			comment: decision?.comment,
			feedback,
		};
	}

	/**
	 * Provide concise guidance in response to a driver request (non-review).
	 */
	public async provideGuidance(driverMessage: string): Promise<string | null> {
		await this.ensureStreamingQuery();
		const prompt = `You are the navigator. Provide ONE short, actionable suggestion to help me proceed.\n\nMy update:\n${driverMessage}\n\nSTRICT: Respond with exactly ONE tag: {{Feedback comment="one short actionable suggestion"}}`;
		this.inputStream?.pushText(prompt);
		let merged = "";
		try {
			await this.waitForNoPendingTools();
			const cmds = await this.waitForBatchCommands();
			// Also merge any raw text accumulated in this batch
			merged = (cmds && Array.isArray(cmds) ? "" : "").toString();
		} catch {}
		const fb = Navigator.parseOptionalFeedback(merged)?.trim();
		if (fb && fb.length > 0) {
			this.emit("message", {
				role: "assistant",
				content: `💡 Guidance: ${fb}`,
				sessionRole: "navigator" as Role,
				timestamp: new Date(),
			});
			return fb;
		}
		return null;
	}

	private static parseApprovalTag(
		text: string,
	): { type: "approve" | "approve_always" | "deny"; comment?: string } | null {
		if (!text) return null;
		const m = text.match(/{{\s*(ApproveAlways|Approve|Deny)([^}]*)}}/i);
		if (!m) return null;
		let type: "approve" | "approve_always" | "deny" = "approve";
		const tag = m[1].toLowerCase();
		if (tag === "approvealways") type = "approve_always";
		else if (tag === "approve") type = "approve";
		else type = "deny";
		const attrs = m[2] || "";
		const cm = attrs.match(/comment\s*=\s*"([\s\S]*?)"/i);
		const comment = cm ? cm[1] : undefined;
		return { type, comment };
	}

	private static parseOptionalFeedback(text: string): string | undefined {
		if (!text) return undefined;
		const m = text.match(/{{\s*Feedback\s+([^}]*)}}/i);
		if (!m) return undefined;
		const attrs = m[1] || "";
		const cm = attrs.match(/comment\s*=\s*"([\s\S]*?)"/i);
		return cm ? cm[1] : undefined;
	}

	private static parseOptionalCodeReview(
		text: string,
	): { pass: boolean; comment?: string } | null {
		if (!text) return null;
		const m = text.match(
			/{{\s*CodeReview(?:\s+comment="([\s\S]*?)")?(?:\s+pass="(true|false)")?\s*}}/i,
		);
		if (!m) return null;
		return { pass: m[2] === "true", comment: m[1] };
	}

	private async processMessages() {
		try {
			// biome-ignore lint/style/noNonNullAssertion: queryIterator guaranteed to exist after ensureStreamingQuery
			for await (const message of this.queryIterator!) {
				if (message.session_id) {
					if (!this.sessionId) {
						this.sessionId = message.session_id;
						this.logger.logEvent("NAVIGATOR_SESSION_CAPTURED", {
							sessionId: this.sessionId,
						});
					} else if (this.sessionId !== message.session_id) {
						this.logger.logEvent("NAVIGATOR_SESSION_MISMATCH", {
							previous: this.sessionId,
							received: message.session_id,
						});
						this.sessionId = message.session_id;
					}
				}
				if (message.type === "assistant" && message.message?.content) {
					const content = message.message.content;
					if (Array.isArray(content)) {
						let fullText = "";
						for (const item of content) {
							if (item.type === "text") {
								fullText += `${item.text}\n`;
							} else if (item.type === "tool_use") {
								this.emit("tool_use", {
									role: "navigator" as Role,
									tool: item.name,
									input: item.input,
								});
								// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK tool_use item structure
								const toolUseId = (item as any).id || (item as any).tool_use_id;
								if (toolUseId) {
									this.pendingTools.add(toolUseId);
									this.logger.logEvent("NAVIGATOR_TOOL_PENDING", {
										id: toolUseId,
										tool: item.name,
									});
								}
							}
						}
						const consolidated = fullText.trim();
						if (consolidated) {
							this.pendingFullText.push(consolidated);
							const allCommands = MockToolParser.parseAllCommands(consolidated);
							if (allCommands.length > 0) {
								for (const cmd of allCommands) {
									this.emit("message", {
										role: "assistant",
										content: MockToolParser.formatForDisplay(cmd),
										sessionRole: "navigator" as Role,
										timestamp: new Date(),
										commandType: cmd.type,
									});
								}
							}
							// No stray text collection in review-only mode
						}
					}
				} else if (
					message.type === "user" &&
					// biome-ignore lint/suspicious/noExplicitAny: SDK message shape
					(message as any).message?.content
				) {
					// biome-ignore lint/suspicious/noExplicitAny: SDK message shape
					const ucontent = (message as any).message.content;
					if (Array.isArray(ucontent)) {
						for (const item of ucontent) {
							if (item.type === "tool_result") {
								// biome-ignore lint/suspicious/noExplicitAny: SDK message shape
								const tid = (item as any).tool_use_id;
								if (tid && this.pendingTools.has(tid)) {
									this.pendingTools.delete(tid);
									this.logger.logEvent("NAVIGATOR_TOOL_RESULT_OBSERVED", {
										id: tid,
									});
								}
							}
						}
						if (this.pendingTools.size === 0) this.resolvePendingToolWaiters();
					}
				} else if (message.type === "result") {
					const merged = this.pendingFullText.join("\n");
					this.pendingFullText = [];
					// Permission decision path takes precedence
					if (this.permissionResolvers.length > 0) {
						const presolver = this.permissionResolvers.shift();
						if (presolver) presolver(merged);
						this.logger.logEvent("NAVIGATOR_PERMISSION_DECISION_BATCH", {
							length: merged.length,
						});
						continue;
					}
					const cmds = MockToolParser.parseAllCommands(merged) || [];
					// Review-only mode: no stray text synthesis
					const resolver = this.batchResolvers.shift();
					if (resolver) resolver(cmds);
					this.logger.logEvent("NAVIGATOR_BATCH_RESULT", {
						commandCount: cmds.length,
					});
				}
			}
		} catch (err) {
			this.logger.logEvent("NAVIGATOR_PROCESS_LOOP_ERROR", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	private waitForBatchCommands(): Promise<NavigatorCommand[]> {
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
				this.logger.logEvent("NAVIGATOR_PENDING_TOOL_TIMEOUT", {
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
			// biome-ignore lint/suspicious/noExplicitAny: SDK iterator exposes optional interrupt
			if (this.queryIterator && (this.queryIterator as any).interrupt) {
				// biome-ignore lint/suspicious/noExplicitAny: see above
				await (this.queryIterator as any).interrupt();
			}
			this.inputStream?.end();
		} catch {}
	}
}
