import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";
import type {
	AgentInputStream,
	AgentSession,
	EmbeddedAgentProvider,
	StreamingAgentSession,
} from "../providers/types.js";
import { isAllToolsEnabled } from "../types/core.js";
import type {
	PermissionOptions,
	PermissionRequest,
	PermissionResult,
} from "../types/permission.js";
import type { NavigatorCommand, Role } from "../types.js";
import type { Logger } from "../utils/logger.js";
import {
	NAVIGATOR_TOOL_NAMES,
	navigatorMcpServer,
} from "../utils/mcpServers.js";
import { TIMEOUT_CONFIG, waitForCondition } from "../utils/timeouts.js";
import { toolTracker } from "../utils/toolTracking.js";
import { PermissionCoordinator } from "./navigator/permissionCoordinator.js";
import {
	NAVIGATOR_CONTINUE_PROMPT_TEMPLATE,
	NAVIGATOR_INITIAL_PROMPT_TEMPLATE,
	NAVIGATOR_REVIEW_PROMPT_TEMPLATE,
	NavigatorUtils,
} from "./navigator/utils.js";
import { normalizeMcpTool } from "./shared/toolUtils.js";

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
	// Track active permission requests to handle concurrent approvals
	private activePermissionRequests = new Set<string>();
	private permissionDecisionsShown = new Map<string, boolean>();

	// New permission coordinator
	private permissionCoordinator: PermissionCoordinator;
	private currentReviewToolId?: string;

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

		// Initialize permission coordinator
		this.permissionCoordinator = new PermissionCoordinator(
			(request) => this.sendPermissionRequestToNavigator(request),
			this.logger,
		);
	}

	/**
	 * Create a plan for the given task (planning phase)
	 * This creates a separate session that is closed after planning
	 */
	async createPlan(task: string): Promise<string | null> {
		this.logger.logEvent("NAVIGATOR_PLANNING_STARTING", {
			task: task.substring(0, 100),
			maxTurns: this.maxTurns,
		});

		let plan: string | null = null;
		let stopReason: string | null = null;
		let turnCount = 0;
		let planningSession: AgentSession | null = null;
		let planningSessionId: string | null = null;
		let detectPlanCompletion: ((message: any) => string | null) | undefined;

		try {
			const toolsToPass = isAllToolsEnabled(this.allowedTools)
				? undefined
				: this.allowedTools;

			// Create planning session with provider
			planningSession = this.provider.createSession({
				systemPrompt: this.systemPrompt,
				allowedTools: toolsToPass,
				maxTurns: this.maxTurns,
				projectPath: this.projectPath,
				mcpServerUrl: this.mcpServerUrl || "",
				permissionMode: "plan",
				diagnosticLogger: (event, data) => {
					this.logger.logEvent(event, {
						agent: "navigator-planning",
						provider: this.provider.name,
						...data,
					});
				},
			});

			// Get provider-specific prompt and completion logic
			const { prompt, detectPlanCompletion: detectFn } =
				this.provider.getPlanningConfig(task);
			detectPlanCompletion = detectFn;
			planningSession.sendMessage(prompt);

			for await (const message of planningSession) {
				// Capture session ID
				if (message.session_id && !planningSessionId) {
					planningSessionId = message.session_id;
					if (planningSession) {
						planningSession.sessionId = planningSessionId;
					}
					this.logger.logEvent("NAVIGATOR_PLANNING_SESSION_CAPTURED", {
						sessionId: planningSessionId,
					});
				}

				// Track turn count and stop reason
				if (message.type === "system") {
					// biome-ignore lint/suspicious/noExplicitAny: Provider message subtype
					if ((message as any).subtype === "turn_limit_reached") {
						stopReason = "turn_limit";
						// biome-ignore lint/suspicious/noExplicitAny: Provider message subtype
					} else if ((message as any).subtype === "conversation_ended") {
						stopReason = "completed";
					}
				}

				// Handle messages
				if (message.type === "assistant" && message.message?.content) {
					turnCount++;
					const content = message.message.content;

					if (!Array.isArray(content)) {
						return null;
					}

					let _fullText = "";

					for (const item of content) {
						if (item.type === "text") {
							const text = item.text ?? "";
							_fullText += `${text}\n`;

							// Emit for display
							this.emit("message", {
								role: "assistant",
								content: text,
								sessionRole: "navigator" as Role,
								timestamp: new Date(),
							});
						} else if (item.type === "tool_use") {
							// Emit tool usage
							this.emit("tool_use", {
								role: "navigator" as Role,
								tool: item.name,
								input: item.input,
							});
						}
					}

					// Use provider-specific completion detection
					if (detectPlanCompletion) {
						const detectedPlan = detectPlanCompletion(message);
						if (detectedPlan) {
							plan = detectedPlan;
							this.logger.logEvent("NAVIGATOR_PLAN_CREATED", {
								planLength: (plan ?? "").length,
								turnCount,
							});
							return plan;
						}
					}
				}
			}

			// Validate the result
			this.logger.logEvent("NAVIGATOR_PLANNING_COMPLETED", {
				stopReason,
				turnCount,
				maxTurns: this.maxTurns,
				hasPlan: !!plan,
				planLength: (plan ?? "").length,
			});

			// Check if we got a valid plan
			this.logger.logEvent("NAVIGATOR_PLAN_VALIDATION_START", {
				hasPlan: !!plan,
				planLength: (plan ?? "").length,
				stopReason,
			});

			if (!plan) {
				if (stopReason === "turn_limit") {
					this.logger.logEvent("NAVIGATOR_PLANNING_FAILED_TURN_LIMIT", {
						turnCount,
					});
					throw new Error(
						`Navigator reached ${this.maxTurns} turn limit without creating a plan. The task may be too complex or need more specific requirements.`,
					);
				} else {
					this.logger.logEvent("NAVIGATOR_PLANNING_FAILED_NO_PLAN", {
						stopReason,
					});
					throw new Error(
						"Navigator completed without creating a plan. Please try rephrasing your task.",
					);
				}
			}

			this.logger.logEvent("NAVIGATOR_RETURNING_PLAN", {
				planLength: String(plan ?? "").length,
				hasValidPlan: !!plan,
			});
			return plan;
		} catch (error) {
			this.logger.logEvent("NAVIGATOR_PLANNING_ERROR", {
				error: error instanceof Error ? error.message : String(error),
				turnCount,
			});
			throw error;
		} finally {
			// Clean up planning session
			if (planningSession) {
				planningSession.end();
				planningSession = null;
			}
		}
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
		isReviewRequested = false,
	): Promise<NavigatorCommand[] | null> {
		this.logger.logEvent("NAVIGATOR_PROCESSING_DRIVER_MESSAGE", {
			messageLength: driverMessage.length,
			sessionId: this.sessionId,
			isFirstMessage: !this.sessionId,
			isReviewRequested,
		});

		try {
			// Ensure a single streaming session
			await this.ensureStreamingQuery();

			if (isReviewRequested) {
				// Clear all permission state when review is requested
				this.activePermissionRequests.clear();
				this.permissionDecisionsShown.clear();
				this.currentReviewToolId = undefined;
			}

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
				// Only use review prompt if explicitly requested
				const template = isReviewRequested
					? NAVIGATOR_REVIEW_PROMPT_TEMPLATE
					: NAVIGATOR_CONTINUE_PROMPT_TEMPLATE;
				const prompt = template.replace("{driverMessage}", driverMessage);
				await this.waitForNoPendingTools();
				this.inputStream?.pushText(prompt);
			}
			// Check for immediate completion commands first, then wait for batch
			const immediateCompletion = this.checkForCompletionCommands();
			if (immediateCompletion.length > 0) {
				return immediateCompletion;
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
		return NavigatorUtils.extractFailedReviewComment(command);
	}

	/**
	 * Check if command indicates session should end
	 */
	static shouldEndSession(command: NavigatorCommand): boolean {
		return command.type === "code_review" && command.pass === true;
	}

	static coerceReviewCommand(command: NavigatorCommand): NavigatorCommand {
		if (command.type === "approve") {
			return {
				...command,
				type: "code_review",
				pass: true,
			};
		}
		if (command.type === "deny") {
			return {
				...command,
				type: "code_review",
				pass: false,
			};
		}
		return command;
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
			diagnosticLogger: (event, data) => {
				this.logger.logEvent(event, {
					agent: "navigator",
					provider: this.provider.name,
					...data,
				});
			},
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
	 * Review a permission request using the new coordinator-based approach
	 */
	public async reviewPermission(
		request: PermissionRequest,
		options: PermissionOptions = {},
	): Promise<PermissionResult> {
		// Ensure request has an ID
		const requestId = request.requestId || randomUUID();
		const requestWithId = { ...request, requestId };

		// Store tool ID for review tracking
		this.currentReviewToolId = request.toolId;
		this.activePermissionRequests.add(requestId);
		this.permissionDecisionsShown.set(requestId, false);

		// Associate permission request ID with tool ID if we have both
		if (request.toolId && requestId) {
			toolTracker.associatePermissionRequest(request.toolId, requestId);
		}

		try {
			// Use the permission coordinator
			const result = await this.permissionCoordinator.requestPermission(
				requestWithId,
				options,
			);

			// Record review result if we have a tool ID
			if (this.currentReviewToolId) {
				toolTracker.recordReview(
					this.currentReviewToolId,
					result.allowed,
					result.allowed ? result.comment : result.reason,
				);
			}

			return result;
		} finally {
			this.resetPermissionState(requestId);
		}
	}

	/**
	 * Send permission request to the navigator (called by permission coordinator)
	 */
	private resetPermissionState(requestId?: string): void {
		if (requestId) {
			this.activePermissionRequests.delete(requestId);
			this.permissionDecisionsShown.delete(requestId);
		}
		// Reset current review tool ID if no active requests
		if (this.activePermissionRequests.size === 0) {
			this.currentReviewToolId = undefined;
		}
	}

	private async sendPermissionRequestToNavigator(
		request: PermissionRequest,
	): Promise<void> {
		const toolDetails = `Tool: ${request.toolName}\nInput: ${JSON.stringify(request.input, null, 2)}`;
		const strictCore = `CRITICAL: This is a PERMISSION REQUEST. You MUST respond with EXACTLY ONE of these MCP tool calls:
- mcp__navigator__navigatorApprove (if you approve this specific edit${request.requestId ? `, include requestId: "${request.requestId}"` : ""})
- mcp__navigator__navigatorDeny (if you reject this specific edit${request.requestId ? `, include requestId: "${request.requestId}"` : ""})

DO NOT call mcp__navigator__navigatorCodeReview for permission requests.`;

		const header =
			!this.sessionId && this.plan && this.originalTask
				? `[CONTEXT] You are the navigator in our pair coding session. I'm implementing the plan.\nTask: ${this.originalTask}\nPlan:\n${this.plan}\n\nWhen I ask for permission to edit files, respond only with MCP decision tools as instructed below. Do not write prose.\n\n[PERMISSION REQUEST]\nMy actions transcript (since last approval):\n${request.driverTranscript}\n\n${toolDetails}\n\n${strictCore}`
				: `[PERMISSION REQUEST]\nMy actions transcript (since last approval):\n${request.driverTranscript}\n\n${toolDetails}\n\n${strictCore}`;

		await this.ensureStreamingQuery();
		await this.waitForNoPendingTools();
		this.inputStream?.pushText(header);
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
								if (!item.name) {
									this.logger.logEvent("NAVIGATOR_TOOL_MISSING_NAME", {
										item: JSON.stringify(item),
									});
									continue;
								}
								const tname = item.name;
								const isDecision = Navigator.isDecisionTool(tname);
								let allowEmit = true;

								// Extract requestId from tool input if it's an approval/denial tool
								const requestId = (item.input as any)?.requestId;

								if (this.activePermissionRequests.size > 0) {
									// We have active permission requests
									if (isDecision) {
										// Check if this decision corresponds to an active permission request
										if (
											requestId &&
											this.activePermissionRequests.has(requestId)
										) {
											// This decision is for an active request - check if we've shown it already
											const alreadyShown =
												this.permissionDecisionsShown.get(requestId);
											allowEmit = !alreadyShown;
											if (!alreadyShown) {
												this.permissionDecisionsShown.set(requestId, true);
											}
										} else if (
											!requestId &&
											this.activePermissionRequests.size === 1
										) {
											// Backward compatibility: no requestId but only one active request
											const activeRequestId = Array.from(
												this.activePermissionRequests,
											)[0];
											const alreadyShown =
												this.permissionDecisionsShown.get(activeRequestId);
											allowEmit = !alreadyShown;
											if (!alreadyShown) {
												this.permissionDecisionsShown.set(
													activeRequestId,
													true,
												);
											}
										} else {
											// Decision doesn't match any active request
											allowEmit = false;
										}
									} else if (tname === "mcp__navigator__navigatorCodeReview") {
										// Do not emit CodeReview during permission approvals
										allowEmit = false;
									}
								} else {
									// No active permission requests - block approve/deny tools
									if (Navigator.isApprovalDenialTool(tname)) {
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

											// For completion or passing review commands, ensure they're delivered on next processDriverMessage call
											// Don't deliver immediately as there might be no resolver waiting
										}
										// Once processed, drop the stored tool data
										this.toolResults.delete(tid);
									}
								}
							}
						}
						if (this.pendingTools.size === 0) {
							this.resolvePendingToolWaiters();
							this.deliverPendingCommandsIfReady();
						}
					}
				} else if (message.type === "result") {
					// Some providers emit a "result" sentinel when a batch is complete
					this.deliverPendingCommandsIfReady(true);

					// If we have active permission requests but no decision tools were received, it's malformed
					if (
						this.activePermissionRequests.size > 0 &&
						this.pendingCommands.length === 0
					) {
						this.permissionCoordinator.handleMalformedResponse();
					}
				}
			}
		} catch (err) {
			this.logger.logEvent("NAVIGATOR_PROCESS_LOOP_ERROR", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	/**
	 * Check for completion commands that are ready to be delivered immediately
	 */
	private checkForCompletionCommands(): NavigatorCommand[] {
		const passingReviews = this.pendingCommands.filter(
			(cmd) => cmd.type === "code_review" && cmd.pass === true,
		);

		if (passingReviews.length > 0) {
			this.pendingCommands = this.pendingCommands.filter(
				(cmd) => !(cmd.type === "code_review" && cmd.pass === true),
			);

			this.logger.logEvent("NAVIGATOR_IMMEDIATE_COMPLETION", {
				commandCount: passingReviews.length,
				commands: passingReviews.map((cmd) => ({
					type: cmd.type,
					comment: cmd.comment,
				})),
			});

			return passingReviews;
		}

		return [];
	}

	private waitForBatchCommands(): Promise<NavigatorCommand[]> {
		return new Promise((resolve) => {
			this.batchResolvers.push(resolve);
		});
	}

	private deliverPendingCommandsIfReady(force = false): void {
		// Check if we have any passing code review commands that should be delivered immediately
		const hasPassingReview = this.pendingCommands.some(
			(cmd) => cmd.type === "code_review" && cmd.pass === true,
		);

		// Also check for decision commands that should be delivered immediately during reviews
		const hasDecisionCommand = this.pendingCommands.some(
			(cmd) =>
				cmd.type === "approve" ||
				cmd.type === "deny" ||
				cmd.type === "code_review",
		);

		// Debug logging
		this.logger.logEvent("NAVIGATOR_DELIVERY_CHECK", {
			pendingToolsCount: this.pendingTools.size,
			pendingCommandsCount: this.pendingCommands.length,
			hasPassingReview,
			hasDecisionCommand,
			force,
			batchResolversCount: this.batchResolvers.length,
			commands: this.pendingCommands.map((cmd) => ({
				type: cmd.type,
				pass: cmd.pass,
			})),
		});

		// Deliver commands if:
		// 1. No pending tools (normal case)
		// 2. Force delivery (result message)
		// 3. Has completion command (immediate delivery)
		// 4. Has decision command (immediate delivery for reviews)
		if (
			this.pendingTools.size > 0 &&
			!force &&
			!hasPassingReview &&
			!hasDecisionCommand
		) {
			this.logger.logEvent("NAVIGATOR_DELIVERY_BLOCKED_PENDING_TOOLS", {
				pendingToolsCount: this.pendingTools.size,
			});
			return;
		}
		if (this.pendingCommands.length === 0 && !force) {
			this.logger.logEvent("NAVIGATOR_DELIVERY_BLOCKED_NO_COMMANDS", {});
			return;
		}

		const resolver = this.batchResolvers.shift();
		if (!resolver) {
			this.logger.logEvent("NAVIGATOR_DELIVERY_BLOCKED_NO_RESOLVER", {
				pendingCommandsCount: this.pendingCommands.length,
				hasPassingReview,
			});
			return;
		}

		// Take only the commands accumulated for this batch
		const commands = this.pendingCommands.slice();
		this.pendingCommands = [];
		this.toolResults.clear();
		try {
			resolver(commands);
		} finally {
			this.logger.logEvent("NAVIGATOR_BATCH_RESULT", {
				commandCount: commands.length,
				hasPassingReview,
			});
		}
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
		return waitForCondition(
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

	private convertMcpToolToCommand(
		toolName: string,
		input: any,
	): NavigatorCommand | null {
		const normalized = Navigator.normalizeNavigatorTool(toolName);

		switch (normalized) {
			case "mcp__navigator__navigatorCodeReview":
				return {
					type: "code_review",
					comment: input.comment,
					pass: input.pass,
				};
			case "mcp__navigator__navigatorApprove": {
				const requestId = input.requestId;
				// Check if this approval is for an active permission request
				const isActiveRequest = requestId
					? this.activePermissionRequests.has(requestId)
					: this.activePermissionRequests.size === 1; // Backward compatibility

				if (isActiveRequest) {
					const command = {
						type: "approve" as const,
						comment: input.comment,
						requestId: input.requestId,
					};
					const handled =
						this.permissionCoordinator.handleNavigatorDecision(command);
					if (handled) {
						// Clean up the specific request ID if provided
						if (requestId) {
							this.resetPermissionState(requestId);
						} else if (this.activePermissionRequests.size === 1) {
							// Backward compatibility: clear the single active request
							const activeRequestId = Array.from(
								this.activePermissionRequests,
							)[0];
							this.resetPermissionState(activeRequestId);
						}
						return null;
					}
					this.logger.logEvent("NAVIGATOR_PERMISSION_DECISION_UNUSED", {});
					if (requestId) {
						this.resetPermissionState(requestId);
					}
					return Navigator.coerceReviewCommand(command);
				}
				// Approve tools outside permission flow should be ignored - only CodeReview should be used for session completion
				this.logger.logEvent("NAVIGATOR_APPROVE_OUTSIDE_PERMISSION_IGNORED", {
					comment: input.comment,
					requestId,
				});
				return null;
			}
			case "mcp__navigator__navigatorDeny": {
				const requestId = input.requestId;
				// Check if this denial is for an active permission request
				const isActiveRequest = requestId
					? this.activePermissionRequests.has(requestId)
					: this.activePermissionRequests.size === 1; // Backward compatibility

				if (isActiveRequest) {
					const command = {
						type: "deny" as const,
						comment: input.comment,
						requestId: input.requestId,
					};
					const handled =
						this.permissionCoordinator.handleNavigatorDecision(command);
					if (handled) {
						// Clean up the specific request ID if provided
						if (requestId) {
							this.resetPermissionState(requestId);
						} else if (this.activePermissionRequests.size === 1) {
							// Backward compatibility: clear the single active request
							const activeRequestId = Array.from(
								this.activePermissionRequests,
							)[0];
							this.resetPermissionState(activeRequestId);
						}
						return null;
					}
					this.logger.logEvent("NAVIGATOR_PERMISSION_DECISION_UNUSED", {});
					if (requestId) {
						this.resetPermissionState(requestId);
					}
					return Navigator.coerceReviewCommand(command);
				}
				// Deny tools outside permission flow should be ignored - only CodeReview should be used for session continuation
				this.logger.logEvent("NAVIGATOR_DENY_OUTSIDE_PERMISSION_IGNORED", {
					comment: input.comment,
					requestId,
				});
				return null;
			}
			default:
				return null;
		}
	}

	private static normalizeNavigatorTool(toolName: string): string {
		return normalizeMcpTool(toolName, "navigator");
	}

	// No fallback text parsing — MCP tools only

	public static normalizeDecisionCommand(
		command: NavigatorCommand,
	): NavigatorCommand {
		if (command.type === "approve") {
			return {
				...command,
				type: "code_review",
				pass: true,
			};
		}
		if (command.type === "deny") {
			return {
				...command,
				type: "code_review",
				pass: false,
			};
		}
		return command;
	}

	private static isDecisionTool(name: string): boolean {
		const normalized = Navigator.normalizeNavigatorTool(name);
		return (
			normalized === "mcp__navigator__navigatorApprove" ||
			normalized === "mcp__navigator__navigatorDeny" ||
			normalized === "mcp__navigator__navigatorCodeReview"
		);
	}

	private static isApprovalDenialTool(name: string): boolean {
		const normalized = Navigator.normalizeNavigatorTool(name);
		return (
			normalized === "mcp__navigator__navigatorApprove" ||
			normalized === "mcp__navigator__navigatorDeny"
		);
	}

	public async stop(): Promise<void> {
		try {
			// Clean up permission coordinator
			this.permissionCoordinator.cleanup();

			if (this.streamingSession?.interrupt) {
				await this.streamingSession.interrupt();
			}
			// Note: inputStream is managed by the streamingSession, no need to end it separately
		} catch {}
	}
}
