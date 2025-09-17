import { EventEmitter } from "node:events";
import { query } from "@anthropic-ai/claude-code";
import type { Role } from "../types.js";
import type { Logger } from "../utils/logger.js";

/**
 * Architect agent - creates comprehensive plans using simple query() API
 */
export class Architect extends EventEmitter {
	private sessionId: string | null = null;

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
			const toolsToPass =
				this.allowedTools[0] === "all" ? undefined : this.allowedTools;

			for await (const message of query({
				prompt: `Our task is to: ${task}\n\nPlease create a clear, step-by-step implementation plan tailored to this repository.\n- Focus on concrete steps, specific files, and commands.\n- Keep it concise and actionable.\n- Do not implement changes now.\n\nWhen your plan is ready, call the ExitPlanMode tool with { plan: <your full plan> } to finish planning.`,
				options: {
					cwd: this.projectPath,
					appendSystemPrompt: this.systemPrompt,
					allowedTools: toolsToPass,
					permissionMode: "plan",
					maxTurns: this.maxTurns,
				},
			})) {
				// Capture session ID
				if (message.session_id && !this.sessionId) {
					this.sessionId = message.session_id;
					this.logger.logEvent("ARCHITECT_SESSION_CAPTURED", {
						sessionId: this.sessionId,
					});
				}

				// Track turn count and stop reason
				if (message.type === "system") {
					// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK system message subtype
					if ((message as any).subtype === "turn_limit_reached") {
						stopReason = "turn_limit";
						// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK system message subtype
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
								_fullText += `${item.text}\n`;

								// Emit for display
								this.emit("message", {
									role: "assistant",
									content: item.text,
									sessionRole: "architect" as Role,
									timestamp: new Date(),
								});
							} else if (item.type === "tool_use") {
								// Emit tool usage
								this.emit("tool_use", {
									role: "architect" as Role,
									tool: item.name,
									input: item.input,
								});

								// Detect plan completion via ExitPlanMode tool
								// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK tool item structure
								const it: any = item as any;
								if (it.name === "ExitPlanMode" && it.input?.plan) {
									plan = it.input.plan as string;
									this.logger.logEvent("ARCHITECT_PLAN_CREATED", {
										planLength: (plan ?? "").length,
										turnCount,
									});
									// Robust early-exit: as soon as ExitPlanMode is called with a plan,
									// return the plan without waiting for a tool_result from the host.
									// This avoids environments that don’t implement the ExitPlanMode tool_result handshake.
									this.logger.logEvent("ARCHITECT_EARLY_RETURN_AFTER_PLAN", {
										reason: "exit_plan_mode_called",
										turnCount,
									});
									return plan;
								}
							}
						}

						// No fallback text capture — plan must be returned via ExitPlanMode tool
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
		}
	}

	/**
	 * Get session ID
	 */
	getSessionId(): string | null {
		return this.sessionId;
	}
}
