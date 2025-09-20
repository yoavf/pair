import { EventEmitter } from "node:events";
import path from "node:path";
import type {
	AgentInputStream,
	EmbeddedAgentProvider,
	StreamingAgentSession,
} from "../providers/types.js";
import {
	NavigatorSessionError,
	PermissionDeniedError,
	PermissionMalformedError,
} from "../types/errors.js";
import type {
	PermissionOptions,
	PermissionRequest,
	PermissionResult,
} from "../types/permission.js";
import type { NavigatorCommand, NavigatorCommandType, Role } from "../types.js";
import type { Logger } from "../utils/logger.js";
import {
	NAVIGATOR_TOOL_NAMES,
	navigatorMcpServer,
} from "../utils/mcpServers.js";
import { TIMEOUT_CONFIG, TimeoutManager } from "../utils/timeouts.js";

// Navigator prompt templates
const NAVIGATOR_INITIAL_PROMPT_TEMPLATE = `[CONTEXT REMINDER] You are the navigator in our pair coding session. You just finished planning our work.

This is YOUR plan for "{originalTask}":

{plan}
---
This is what I've done so far: {driverMessage}`;

const NAVIGATOR_REVIEW_PROMPT_TEMPLATE = `{driverMessage}

Use git diff / read tools to double check my work.

CRITICAL: You MUST respond with EXACTLY ONE MCP tool call:
- mcp__navigator__navigatorCodeReview with comment="assessment" and pass=true/false
- mcp__navigator__navigatorComplete with summary="what was accomplished"

Only mcp__navigator__navigatorCodeReview OR mcp__navigator__navigatorComplete. No text.`;

// Permission decision type using proper NavigatorCommandType subset
type PermissionDecisionType =
	| Extract<NavigatorCommandType, "approve" | "deny">
	| "none";

/**
 * Navigator agent - monitors driver implementation and reviews code
 */
export class Navigator extends EventEmitter {
	private sessionId: string | null = null;
	private inputStream?: AgentInputStream;
	private streamingSession: StreamingAgentSession | null = null;
	private processingLoopStarted = false;
	private batchResolvers: Array<(cmds: NavigatorCommand[]) => void> = [];
	private pendingCommands: NavigatorCommand[] = [];
	private pendingTools: Set<string> = new Set();
	private pendingToolWaiters: Array<() => void> = [];
	private toolResults: Map<string, any> = new Map();

	// Track permission-approval display state to avoid duplicate decisions
	private inPermissionApproval = false;
	private permissionDecisionShown = false;

	constructor(
		private systemPrompt: string,
		private allowedTools: string[],
		private maxTurns: number,
		private projectPath: string,
		private logger: Logger,
		private provider: EmbeddedAgentProvider,
		private mcpServerUrl?: string,
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
	 * Process driver message and provide review
	 */
	async processDriverMessage(
		driverMessage: string,
	): Promise<NavigatorCommand[] | null> {
		this.logger.logEvent("NAVIGATOR_PROCESSING_DRIVER_MESSAGE", {
			messageLength: driverMessage.length,
			sessionId: this.sessionId,
			isFirstMessage: !this.sessionId,
		});

		try {
			// Ensure a single streaming session
			await this.ensureStreamingQuery();

			if (!this.sessionId) {
				const prompt = NAVIGATOR_INITIAL_PROMPT_TEMPLATE.replace(
					"{originalTask}",
					this.originalTask ?? "",
				)
					.replace("{plan}", this.plan ?? "")
					.replace("{driverMessage}", driverMessage);
				await this.waitForNoPendingTools();
				this.inputStream?.pushText(prompt);
			} else {
				const prompt = NAVIGATOR_REVIEW_PROMPT_TEMPLATE.replace(
					"{driverMessage}",
					driverMessage,
				);
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
	 * Extract review comments from a failed code review
	 */
	static extractFailedReviewComment(command: NavigatorCommand): string | null {
		if (command.type === "code_review" && command.pass === false) {
			return (
				command.comment || "Please address the review comments and continue."
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
		if (this.streamingSession) return;

		// Silent gating: allow only pre-approved tools; deny others without emitting messages
		const navCanUseTool = async (
			toolName: string,
			input: Record<string, unknown>,
		) => {
			try {
				// Deny any write attempts
				if (
					toolName === "Write" ||
					toolName === "Edit" ||
					toolName === "MultiEdit"
				) {
					return {
						behavior: "deny" as const,
						message: "Navigator cannot modify files",
					};
				}
				// Read must target a file within the repo (silent deny otherwise)
				if (toolName === "Read") {
					const fp = String(
						(input as any)?.file_path ?? (input as any)?.path ?? "",
					);
					if (!fp)
						return {
							behavior: "deny" as const,
							message: "Read requires a file path",
						};
					if (fp.startsWith("/dev/null"))
						return {
							behavior: "deny" as const,
							message: "Cannot read /dev/null",
						};
					const abs = path.isAbsolute(fp)
						? fp
						: path.resolve(this.projectPath, fp);
					const normalizedProject = path.resolve(this.projectPath) + path.sep;
					const normalizedAbs = path.resolve(abs) + path.sep;
					if (!normalizedAbs.startsWith(normalizedProject))
						return {
							behavior: "deny" as const,
							message: "Read files must be within project directory",
						};
				}
				// Bash only for git diff/status/show
				if (toolName === "Bash") {
					const cmd = String((input as any)?.command ?? "").trim();
					if (/[;&|`$<>]/.test(cmd))
						return {
							behavior: "deny" as const,
							message: "Bash commands with special characters not allowed",
						};
					if (!/^(git\s+(diff|status|show)\b)/.test(cmd))
						return {
							behavior: "deny" as const,
							message: "Bash only allowed for git diff/status/show commands",
						};
				}
			} catch {}
			return { behavior: "allow" as const, updatedInput: input };
		};

		// Create streaming session using provider
		this.streamingSession = this.provider.createStreamingSession({
			systemPrompt: this.systemPrompt,
			allowedTools: this.allowedTools,
			additionalMcpTools: NAVIGATOR_TOOL_NAMES,
			maxTurns: this.maxTurns,
			projectPath: this.projectPath,
			mcpServerUrl: this.mcpServerUrl,
			embeddedMcpServer: navigatorMcpServer,
			mcpRole: "navigator",
			canUseTool: navCanUseTool,
			disallowedTools: ["Write", "Edit", "MultiEdit"],
			includePartialMessages: true,
		});

		// Use the session's input stream
		this.inputStream = this.streamingSession.inputStream;

		// Log session creation
		try {
			this.logger.logEvent("NAVIGATOR_QUERY_INIT", {
				allowedTools: this.allowedTools,
				disallowedTools: ["Write", "Edit", "MultiEdit"],
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

	/**
	 * Review a permission request and return approval or throw explicit error
	 */
	public async reviewPermission(
		request: PermissionRequest,
		options: PermissionOptions = {},
	): Promise<PermissionResult> {
		const { signal } = options;

		signal?.throwIfAborted();

		const toolDetails = `Tool: ${request.toolName}\nInput: ${JSON.stringify(request.input, null, 2)}`;
		const strictCore = `Respond with EXACTLY ONE decision MCP tool call:\n- mcp__navigator__navigatorApprove\n- mcp__navigator__navigatorDeny`;

		const header =
			!this.sessionId && this.plan && this.originalTask
				? `[CONTEXT] You are the navigator in our pair coding session. I'm implementing the plan.\nTask: ${this.originalTask}\nPlan:\n${this.plan}\n\nWhen I ask for permission to edit files, respond only with MCP decision tools as instructed below. Do not write prose.\n\n[PERMISSION REQUEST]\nMy actions transcript (since last approval):\n${request.driverTranscript}\n\n${toolDetails}\n\n${strictCore}`
				: `[PERMISSION REQUEST]\nMy actions transcript (since last approval):\n${request.driverTranscript}\n\n${toolDetails}\n\n${strictCore}`;

		this.inPermissionApproval = true;
		this.permissionDecisionShown = false;

		try {
			await this.ensureStreamingQuery();
			await this.waitForNoPendingTools();

			signal?.throwIfAborted();

			this.inputStream?.pushText(header);

			const result = await this.waitForPermissionDecision();

			signal?.throwIfAborted();

			const decision = this.extractPermissionDecision(result.commands);

			if (decision.type === "approve") {
				return {
					allowed: true,
					updatedInput: request.input,
					comment: decision.comment,
				};
			}

			if (decision.type === "deny") {
				return {
					allowed: false,
					reason: decision.comment || "Navigator denied permission",
				};
			}

			throw new PermissionMalformedError("Navigator provided invalid decision");
		} catch (err) {
			if (
				err instanceof PermissionDeniedError ||
				err instanceof PermissionMalformedError
			) {
				throw err;
			}
			throw new NavigatorSessionError(
				err instanceof Error ? err.message : String(err),
			);
		} finally {
			this.inPermissionApproval = false;
			this.permissionDecisionShown = false;
		}
	}

	private extractPermissionDecision(commands: NavigatorCommand[]): {
		type: PermissionDecisionType;
		comment?: string;
	} {
		for (const cmd of commands) {
			if (cmd.type === "approve") {
				return { type: "approve", comment: cmd.comment };
			}
			if (cmd.type === "deny") {
				return { type: "deny", comment: cmd.comment };
			}
		}
		return { type: "none" };
	}

	private async waitForPermissionDecision(): Promise<{
		commands: NavigatorCommand[];
	}> {
		return this.waitForBatchCommands().then((commands) => ({ commands }));
	}

	private async processMessages() {
		try {
			// biome-ignore lint/style/noNonNullAssertion: streamingSession guaranteed to exist after ensureStreamingQuery
			for await (const message of this.streamingSession!) {
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
						let _fullText = "";
						for (const item of content) {
							if (item.type === "text") {
								// Do not emit free-form navigator text; tools only
								_fullText += `${item.text}\n`;
							} else if (item.type === "tool_use") {
								const tname = item.name || "";
								const isDecision = Navigator.isDecisionTool(tname);
								let allowEmit = true;
								if (this.inPermissionApproval) {
									if (isDecision) {
										// Only emit the first decision tool line per approval window
										allowEmit = !this.permissionDecisionShown;
										this.permissionDecisionShown = true;
									} else if (tname === "mcp__navigator__navigatorCodeReview") {
										// Do not emit CodeReview during permission approvals
										allowEmit = false;
									}
								}
								if (allowEmit) {
									this.emit("tool_use", {
										role: "navigator" as Role,
										tool: tname,
										input: item.input,
									});
								}
								// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK tool_use item structure
								const toolUseId = (item as any).id || (item as any).tool_use_id;
								if (toolUseId) {
									this.pendingTools.add(toolUseId);
									this.logger.logEvent("NAVIGATOR_TOOL_PENDING", {
										id: toolUseId,
										tool: item.name,
									});
									// Store MCP tool results
									this.toolResults.set(toolUseId, {
										toolName: tname,
										input: item.input,
									});
								}
							}
						}
						// Process MCP tool calls to create NavigatorCommands
						for (const [toolId, toolData] of this.toolResults) {
							if (this.pendingTools.has(toolId)) continue; // Wait for tool_result

							const cmd = this.convertMcpToolToCommand(
								toolData.toolName,
								toolData.input,
							);
							if (cmd) {
								this.pendingCommands.push(cmd);
								// Only create bubbles when processing tool_result below to avoid duplicates
							}
						}

						// No fallback text parsing — MCP tools only
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
										this.logger.logEvent("NAVIGATOR_TOOL_RESULT_ERROR", {
											isError: isErr,
											text: errText,
											tool_use_id: anyItem.tool_use_id,
										});
									}
								} catch {}
								// biome-ignore lint/suspicious/noExplicitAny: SDK message shape
								const tid = (item as any).tool_use_id;
								if (tid && this.pendingTools.has(tid)) {
									this.pendingTools.delete(tid);
									this.logger.logEvent("NAVIGATOR_TOOL_RESULT_OBSERVED", {
										id: tid,
									});
									// Convert this completed tool call into a NavigatorCommand now
									const tdata = this.toolResults.get(tid);
									if (tdata) {
										const cmd = this.convertMcpToolToCommand(
											tdata.toolName,
											tdata.input,
										);
										if (cmd) {
											this.pendingCommands.push(cmd);
										}
										// Once processed, drop the stored tool data
										this.toolResults.delete(tid);
									}
								}
							}
						}
						if (this.pendingTools.size === 0) this.resolvePendingToolWaiters();
					}
				} else if (message.type === "result") {
					// Regular command processing - use MCP commands
					const cmds =
						this.pendingCommands.length > 0 ? this.pendingCommands : [];
					this.pendingCommands = [];
					this.toolResults.clear();
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

	private waitForNoPendingTools(
		timeoutMs = TIMEOUT_CONFIG.TOOL_COMPLETION,
	): Promise<void> {
		return TimeoutManager.createWaiterTimeout(
			() => this.pendingTools.size === 0,
			async () => {
				this.logger.logEvent("NAVIGATOR_PENDING_TOOL_TIMEOUT", {
					pendingCount: this.pendingTools.size,
					ids: Array.from(this.pendingTools),
				});
				// Interrupt the session to prevent malformed message streams
				try {
					if (this.streamingSession?.interrupt) {
						await this.streamingSession.interrupt();
					}
				} catch (error) {
					this.logger.logEvent("NAVIGATOR_SESSION_INTERRUPT_ERROR", {
						error: error instanceof Error ? error.message : String(error),
					});
				}
				throw new Error(
					`Navigator tool results timed out after ${timeoutMs}ms. Pending tools: ${Array.from(this.pendingTools).join(", ")}`,
				);
			},
			timeoutMs,
			(callback) => this.pendingToolWaiters.push(callback),
		);
	}

	/**
	 * Convert MCP tool call to NavigatorCommand
	 */
	private convertMcpToolToCommand(
		toolName: string,
		input: any,
	): NavigatorCommand | null {
		switch (toolName) {
			case "mcp__navigator__navigatorCodeReview":
				return {
					type: "code_review",
					comment: input.comment,
					pass: input.pass,
				};
			case "mcp__navigator__navigatorComplete":
				return { type: "complete", summary: input.summary };
			case "mcp__navigator__navigatorApprove":
				return { type: "approve", comment: input.comment };
			case "mcp__navigator__navigatorDeny":
				return { type: "deny", comment: input.comment };
			default:
				return null;
		}
	}

	// No fallback text parsing — MCP tools only

	private static isDecisionTool(name: string): boolean {
		return (
			name === "mcp__navigator__navigatorApprove" ||
			name === "mcp__navigator__navigatorDeny" ||
			name === "mcp__navigator__navigatorCodeReview"
		);
	}

	public async stop(): Promise<void> {
		try {
			if (this.streamingSession?.interrupt) {
				await this.streamingSession.interrupt();
			}
			// Note: inputStream is managed by the streamingSession, no need to end it separately
		} catch {}
	}
}
