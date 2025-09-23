import { EventEmitter } from "node:events";
import type {
	AgentSession,
	EmbeddedAgentProvider,
} from "../providers/types.js";
import { isAllToolsEnabled } from "../types/core.js";
import type { Role } from "../types.js";
import type { Logger } from "../utils/logger.js";

/**
 * Architect agent - creates comprehensive plans using the provider's session API
 */
export class Architect extends EventEmitter {
	private sessionId: string | null = null;
	private session: AgentSession | null = null;

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
	 * Create a plan for the given task
	 */
	async createPlan(task: string): Promise<string | null> {
		this.logger.logEvent("ARCHITECT_STARTING", {
			task: task.substring(0, 100),
			maxTurns: this.maxTurns,
		});

		let plan: string | null = null;
		let stopReason: string | null = null;
		let turnCount = 0;

		try {
			const toolsToPass = isAllToolsEnabled(this.allowedTools)
				? undefined
				: this.allowedTools;
			const isOpenCodeProvider = this.provider.name === "opencode";

			// Create session with provider
			// Note: Architect doesn't use MCP server, but we keep the parameter for consistency
			this.session = this.provider.createSession({
				systemPrompt: this.systemPrompt,
				allowedTools: toolsToPass,
				maxTurns: this.maxTurns,
				projectPath: this.projectPath,
				mcpServerUrl: this.mcpServerUrl || "", // Empty for Architect since it doesn't use MCP
				permissionMode: "plan",
				diagnosticLogger: (event, data) => {
					this.logger.logEvent(event, {
						agent: "architect",
						provider: this.provider.name,
						...data,
					});
				},
			});

			// Send the initial prompt - adjust based on provider
			const prompt = isOpenCodeProvider
				? `Our task is to: ${task}\n\nPlease create a clear, step-by-step implementation plan tailored to this repository.\n- Focus on concrete steps, specific files, and commands.\n- Keep it concise and actionable.\n- Do not implement changes now.\n\nEnd your response with "PLAN COMPLETE" when you finish the plan.`
				: `Our task is to: ${task}\n\nPlease create a clear, step-by-step implementation plan tailored to this repository.\n- Focus on concrete steps, specific files, and commands.\n- Keep it concise and actionable.\n- Do not implement changes now.\n\nWhen your plan is ready, call the ExitPlanMode tool with { plan: <your full plan> } to finish planning.`;
			this.session.sendMessage(prompt);

			for await (const message of this.session) {
				// Capture session ID
				if (message.session_id && !this.sessionId) {
					this.sessionId = message.session_id;
					if (this.session) {
						this.session.sessionId = this.sessionId;
					}
					this.logger.logEvent("ARCHITECT_SESSION_CAPTURED", {
						sessionId: this.sessionId,
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

					if (Array.isArray(content)) {
						let _fullText = "";

						for (const item of content) {
							if (item.type === "text") {
								const text = item.text ?? "";
								_fullText += `${text}\n`;

								// Emit for display
								this.emit("message", {
									role: "assistant",
									content: text,
									sessionRole: "architect" as Role,
									timestamp: new Date(),
								});

								// For OpenCode, check if plan is complete based on text content
								if (isOpenCodeProvider && text.includes("PLAN COMPLETE")) {
									plan = _fullText.replace("PLAN COMPLETE", "").trim();
									this.logger.logEvent("ARCHITECT_PLAN_CREATED_FROM_TEXT", {
										planLength: (plan ?? "").length,
										turnCount,
									});
									return plan;
								}
							} else if (item.type === "tool_use") {
								// Emit tool usage
								this.emit("tool_use", {
									role: "architect" as Role,
									tool: item.name,
									input: item.input,
								});

								// Detect plan completion via ExitPlanMode tool (Claude Code)
								// biome-ignore lint/suspicious/noExplicitAny: Provider tool item structure
								const it: any = item as any;
								if (it.name === "ExitPlanMode" && it.input?.plan) {
									plan = it.input.plan as string;
									this.logger.logEvent("ARCHITECT_PLAN_CREATED", {
										planLength: (plan ?? "").length,
										turnCount,
									});
									// Robust early-exit: as soon as ExitPlanMode is called with a plan,
									// return the plan without waiting for a tool_result from the host.
									// This avoids environments that don't implement the ExitPlanMode tool_result handshake.
									this.logger.logEvent("ARCHITECT_EARLY_RETURN_AFTER_PLAN", {
										reason: "exit_plan_mode_called",
										turnCount,
									});
									return plan;
								}
							}
						}

						// For OpenCode, also check if we have accumulated a complete plan
						if (
							isOpenCodeProvider &&
							_fullText.includes("PLAN COMPLETE") &&
							!plan
						) {
							plan = _fullText.replace("PLAN COMPLETE", "").trim();
							this.logger.logEvent("ARCHITECT_PLAN_CREATED_FROM_FULLTEXT", {
								planLength: (plan ?? "").length,
								turnCount,
							});
							return plan;
						}

						// No fallback text capture for Claude Code — plan must be returned via ExitPlanMode tool
					}
				}
			}

			// Validate the result
			this.logger.logEvent("ARCHITECT_COMPLETED", {
				stopReason,
				turnCount,
				maxTurns: this.maxTurns,
				hasPlan: !!plan,
				planLength: (plan ?? "").length,
			});

			// Marker to verify control remains in createPlan after completion log
			this.logger.logEvent("ARCHITECT_POST_COMPLETION_MARK", {
				reached: true,
			});

			// Check if we got a valid plan
			this.logger.logEvent("ARCHITECT_PLAN_VALIDATION_START", {
				hasPlan: !!plan,
				planLength: (plan ?? "").length,
				stopReason,
			});

			if (!plan) {
				if (stopReason === "turn_limit") {
					this.logger.logEvent("ARCHITECT_FAILED_TURN_LIMIT", { turnCount });
					throw new Error(
						`Architect reached ${this.maxTurns} turn limit without creating a plan. The task may be too complex or need more specific requirements.`,
					);
				} else {
					this.logger.logEvent("ARCHITECT_FAILED_NO_PLAN", { stopReason });
					throw new Error(
						"Architect completed without creating a plan. Please try rephrasing your task.",
					);
				}
			}

			this.logger.logEvent("ARCHITECT_PLAN_VALIDATION_PASSED", {
				planLength: String(plan ?? "").length,
				stopReason,
			});

			this.logger.logEvent("ARCHITECT_RETURNING_PLAN", {
				planLength: String(plan ?? "").length,
				hasValidPlan: !!plan,
			});
			return plan;
		} catch (error) {
			this.logger.logEvent("ARCHITECT_ERROR", {
				error: error instanceof Error ? error.message : String(error),
				turnCount,
			});
			throw error;
		} finally {
			// Clean up session
			if (this.session) {
				this.session.end();
				this.session = null;
			}
		}
	}

	/**
	 * Get session ID
	 */
	getSessionId(): string | null {
		return this.sessionId;
	}
}
