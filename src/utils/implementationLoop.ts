/**
 * Implementation loop orchestration between driver and navigator
 */

import { Driver } from "../conversations/Driver.js";
import { Navigator } from "../conversations/Navigator.js";
import type { InkDisplayManager } from "../display.js";
import type { NavigatorCommand } from "../types.js";
import type { Logger } from "./logger.js";

export interface ImplementationLoopConfig {
	sessionHardLimitMs: number;
	driverMaxTurns: number;
}

export class ImplementationLoop {
	private sessionTimer?: NodeJS.Timeout;
	private driverBuffer: string[] = [];

	constructor(
		private driver: Driver,
		private navigator: Navigator,
		private display: InkDisplayManager,
		private logger: Logger,
		private config: ImplementationLoopConfig,
		private onExit: (completionMessage?: string) => Promise<void>,
	) {}

	/**
	 * Run the implementation loop between driver and navigator
	 */
	async run(task: string, plan: string): Promise<void> {
		// Set hard session time limit
		const limitMs = this.config.sessionHardLimitMs;
		const deadline = Date.now() + limitMs;
		this.sessionTimer = setTimeout(() => {
			try {
				this.logger.logEvent("IMPLEMENTATION_HARD_LIMIT_REACHED", {
					limitMs,
				});
				this.display.updateStatus(
					`⏲️ Session limit reached (${Math.floor(limitMs / 60000)}m) — stopping...`,
				);
				void this.onExit();
			} catch {}
		}, limitMs);

		// Initialize navigator with plan context
		this.logger.logEvent("IMPLEMENTATION_LOOP_NAVIGATOR_INIT_START", {});
		await this.navigator.initialize(task, plan);
		this.logger.logEvent("IMPLEMENTATION_LOOP_NAVIGATOR_INIT_COMPLETE", {});

		// Start driver implementation
		this.logger.logEvent("IMPLEMENTATION_LOOP_DRIVER_START", {});
		let driverMessages = await this.driver.startImplementation(plan);
		this.driverBuffer = [];
		this.logger.logEvent("IMPLEMENTATION_LOOP_DRIVER_INITIAL_MESSAGES", {
			messageCount: driverMessages.length,
		});

		// Main implementation loop
		let loopCount = 0;
		let awaitingReviewDecision = false;
		let awaitingDriverResponseAfterGuidance = false;
		while (true) {
			if (Date.now() > deadline) {
				this.logger.logEvent("IMPLEMENTATION_LOOP_DEADLINE_EXIT", {});
				break;
			}
			loopCount++;
			this.logger.logEvent("IMPLEMENTATION_LOOP_ITERATION", {
				loopCount,
				driverSessionId: this.driver.getSessionId(),
				navigatorSessionId: this.navigator.getSessionId(),
			});

			const driverProducedOutput = (driverMessages || []).some(
				(msg) => msg && msg.trim().length > 0,
			);
			if (driverProducedOutput) {
				awaitingDriverResponseAfterGuidance = false;
			}

			// Check if driver requested review via MCP tools
			const driverCommands = this.driver.getAndClearDriverCommands();
			const driverCommand =
				driverCommands.length > 0 ? driverCommands[0] : null;
			const dcType = driverCommand?.type;

			this.logger.logEvent("IMPLEMENTATION_LOOP_LOOP_STATE", {
				loopCount,
				awaitingReviewDecision,
				awaitingDriverResponseAfterGuidance,
				driverCommandType: dcType ?? null,
				driverCommandCount: driverCommands.length,
				driverProducedOutput,
			});

			// Guardrail: if driver text indicates completion intent but no review tool was called, nudge to request review immediately
			if (!dcType && !awaitingReviewDecision) {
				const combinedDriverText = (driverMessages || [])
					.join("\n")
					.toLowerCase();
				if (this.detectsCompletionIntent(combinedDriverText)) {
					this.display.updateStatus(
						"Driver indicated completion — prompting to request review…",
					);
					const prompt =
						"It sounds like you consider the implementation complete. Please request a review now by calling the mcp__driver__driverRequestReview tool with a brief context of what you implemented. Do not continue with further edits until the review is returned.";
					driverMessages = await this.driver.continueWithFeedback(prompt);
					continue;
				}
			}

			if (dcType === "request_review") {
				// Immediately stop the driver session to prevent it from producing more output while waiting for review
				this.logger.logEvent("IMPLEMENTATION_LOOP_DRIVER_STOP_FOR_REVIEW", {});
				await this.driver.stop();

				const reviewResult = await this.handleReviewRequest(
					driverCommand,
					driverMessages,
				);
				awaitingReviewDecision = reviewResult.awaitingDecision;
				if (reviewResult.awaitingDecision) {
					this.logger.logEvent("IMPLEMENTATION_LOOP_REVIEW_WAITING", {
						driverCommandContextLength: driverCommand?.context?.length ?? 0,
					});
				} else {
					this.logger.logEvent("IMPLEMENTATION_LOOP_REVIEW_RESULT", {
						shouldEnd: reviewResult.shouldEnd,
						hasReviewComments: !!reviewResult.reviewComments,
						endSummaryLength: reviewResult.endSummary?.length ?? 0,
					});
				}
				if (reviewResult.shouldEnd) {
					await this.onExit(reviewResult.endSummary);
					return;
				}
				if (reviewResult.reviewComments) {
					this.logger.logEvent("IMPLEMENTATION_LOOP_REVIEW_FEEDBACK", {
						reviewLength: reviewResult.reviewComments.length,
					});
					driverMessages = await this.driver.continueWithFeedback(
						reviewResult.reviewComments,
					);
				}
			} else if (dcType === "request_guidance") {
				const guidanceResult = await this.handleGuidanceRequest(driverMessages);
				awaitingDriverResponseAfterGuidance = guidanceResult.awaitingResponse;
				if (guidanceResult.shouldEnd) {
					await this.onExit(guidanceResult.endReason);
					return;
				}
				if (guidanceResult.driverMessages) {
					driverMessages = guidanceResult.driverMessages;
				}
			} else {
				// Default path: simply continue (unless we're waiting on a review decision or guidance follow-up)
				if (awaitingReviewDecision || awaitingDriverResponseAfterGuidance) {
					this.logger.logEvent("IMPLEMENTATION_LOOP_WAITING", {
						awaitingReviewDecision,
						awaitingDriverResponseAfterGuidance,
					});
					await new Promise((resolve) => setTimeout(resolve, 500));
					continue;
				}
				this.driverBuffer = [];
				driverMessages =
					await this.driver.continueWithFeedback("Please continue.");
			}
		}
	}

	private async handleReviewRequest(
		driverCommand: any,
		driverMessages: string[],
	): Promise<{
		awaitingDecision: boolean;
		shouldEnd: boolean;
		endSummary?: string;
		reviewComments?: string;
	}> {
		this.logger.logEvent("IMPLEMENTATION_LOOP_REVIEW_REQUESTED", {});
		this.logger.logEvent("IMPLEMENTATION_LOOP_REVIEW_REQUEST", {
			driverBufferLength: this.driverBuffer.length,
			driverMessagesCount: driverMessages.length,
			driverCommandContextLength: driverCommand?.context?.length ?? 0,
		});
		const combinedMessage = Driver.combineMessagesForNavigator([
			...this.driverBuffer,
			...driverMessages,
		]);
		this.driverBuffer = [];
		const trimmed = combinedMessage.trim();
		const navigatorMessage =
			trimmed.length > 0
				? combinedMessage
				: driverCommand?.context?.trim().length
					? (driverCommand?.context ?? "")
					: "Driver reports implementation complete and requested review via mcp__driver__driverRequestReview.";
		const messageForNavigator = navigatorMessage.trim();

		if (messageForNavigator.length > 0) {
			this.display.showTransfer("driver", "navigator", "Review request");
			this.logger.logEvent("IMPLEMENTATION_LOOP_SENDING_REVIEW_TO_NAVIGATOR", {
				messageLength: messageForNavigator.length,
			});

			// biome-ignore lint/suspicious/noExplicitAny: Navigator command response type from Claude Code SDK
			const _navResp: any = await this.navigator.processDriverMessage(
				messageForNavigator,
				true,
			); // true = review was requested
			// biome-ignore lint/suspicious/noExplicitAny: Navigator command array type from Claude Code SDK
			const navCommands: any[] = Array.isArray(_navResp)
				? _navResp
				: _navResp
					? [_navResp]
					: [];

			if (navCommands.length > 0) {
				let reviewComments: string | null = null;
				let shouldEnd = false;
				let endSummary: string | undefined;

				for (const cmd of navCommands) {
					this.logger.logEvent("IMPLEMENTATION_LOOP_NAVIGATOR_COMMAND", {
						commandType: cmd.type,
						hasComment: !!cmd.comment,
						pass: cmd.pass,
					});

					if (cmd.type === "code_review") {
						this.display.setPhase("review");
						// Only extract comments for failed reviews
						if (!cmd.pass) {
							reviewComments = Navigator.extractFailedReviewComment(cmd);
						}
					}

					if (Navigator.shouldEndSession(cmd)) {
						shouldEnd = true;
						if (cmd.type === "code_review" && cmd.pass) {
							endSummary = cmd.comment;
						} else {
							endSummary = cmd.comment;
						}
					}
				}

				if (reviewComments && !shouldEnd) {
					this.logger.logEvent(
						"IMPLEMENTATION_LOOP_NAVIGATOR_REVIEW_COMMENTS",
						{
							commentsLength: reviewComments.length,
						},
					);
					this.display.showTransfer("navigator", "driver", "Review comments");
					this.display.setPhase("execution");
					return {
						awaitingDecision: false,
						shouldEnd: false,
						reviewComments,
					};
				}

				if (shouldEnd) {
					this.logger.logEvent("IMPLEMENTATION_LOOP_COMPLETED", {
						summary: endSummary || "Implementation finished",
					});
					this.display.setPhase("complete");
					return {
						awaitingDecision: false,
						shouldEnd: true,
						endSummary,
					};
				}
			} else {
				// Handle retry logic for navigator decisions
				this.logger.logEvent("IMPLEMENTATION_LOOP_NAVIGATOR_RETRY_PATH", {});
				return await this.handleNavigatorRetry(messageForNavigator);
			}
		}

		return { awaitingDecision: true, shouldEnd: false };
	}

	private async handleNavigatorRetry(messageForNavigator: string): Promise<{
		awaitingDecision: boolean;
		shouldEnd: boolean;
		endSummary?: string;
		reviewComments?: string;
	}> {
		// If no commands, re-prompt the navigator until we get a decision (bounded retries)
		this.display.updateStatus("Waiting for review decision…");
		let attempts = 0;
		this.logger.logEvent("IMPLEMENTATION_LOOP_NAVIGATOR_RETRY_START", {});
		while (attempts < 5) {
			attempts++;
			const retryPrompt = `${messageForNavigator}\n\nSTRICT: Respond with exactly one MCP tool call: mcp__navigator__navigatorCodeReview. No other text.`;
			const retryResp = await this.navigator.processDriverMessage(
				retryPrompt,
				true,
			); // true = still reviewing
			const cmds: NavigatorCommand[] = Array.isArray(retryResp)
				? retryResp
				: retryResp
					? [retryResp]
					: [];

			if (cmds.length > 0) {
				this.logger.logEvent("IMPLEMENTATION_LOOP_NAVIGATOR_RETRY_RESPONDED", {
					attempts,
					commandTypes: cmds.map((cmd) => cmd.type),
				});
				const reviewParts: string[] = [];
				let shouldEnd = false;
				let endSummary: string | undefined;

				for (const cmd of cmds) {
					this.logger.logEvent("IMPLEMENTATION_LOOP_NAVIGATOR_COMMAND", {
						commandType: cmd.type,
						hasComment: !!cmd.comment,
						pass: cmd.pass,
					});

					if (cmd.type === "code_review") {
						this.display.setPhase("review");
						if (!cmd.pass) {
							const comment = Navigator.extractFailedReviewComment(cmd);
							if (comment && comment.trim().length > 0)
								reviewParts.push(comment);
						}
					}

					if (Navigator.shouldEndSession(cmd)) {
						shouldEnd = true;
						if (cmd.type === "code_review" && cmd.pass) {
							endSummary = cmd.comment;
						} else {
							endSummary = cmd.comment;
						}
					}
				}

				if (reviewParts.length > 0 && !shouldEnd) {
					this.logger.logEvent("IMPLEMENTATION_LOOP_NAVIGATOR_RETRY_FEEDBACK", {
						reviewLength: reviewParts.join("\n\n").length,
					});
					const reviewMessage = reviewParts.join("\n\n");
					this.display.showTransfer("navigator", "driver", "Review comments");
					this.display.setPhase("execution");
					return {
						awaitingDecision: false,
						shouldEnd: false,
						reviewComments: reviewMessage,
					};
				}

				if (shouldEnd) {
					this.logger.logEvent("IMPLEMENTATION_LOOP_COMPLETED", {
						summary: endSummary || "Implementation finished",
					});
					this.display.setPhase("complete");
					return {
						awaitingDecision: false,
						shouldEnd: true,
						endSummary,
					};
				}
				break;
			}
			await new Promise((r) => setTimeout(r, 1000));
		}

		if (attempts >= 5) {
			this.logger.logEvent("IMPLEMENTATION_LOOP_NAVIGATOR_EMPTY_DECISION", {});
		}

		return { awaitingDecision: true, shouldEnd: false };
	}

	private async handleGuidanceRequest(driverMessages: string[]): Promise<{
		awaitingResponse: boolean;
		shouldEnd: boolean;
		endReason?: string;
		driverMessages?: string[];
	}> {
		this.logger.logEvent("IMPLEMENTATION_LOOP_GUIDANCE_REQUESTED", {});
		const combinedMessage = Driver.combineMessagesForNavigator([
			...this.driverBuffer,
			...driverMessages,
		]);
		this.driverBuffer = [];

		if (combinedMessage) {
			this.display.showTransfer("driver", "navigator", "Guidance request");
			this.logger.logEvent(
				"IMPLEMENTATION_LOOP_SENDING_GUIDANCE_TO_NAVIGATOR",
				{
					messageLength: combinedMessage.length,
				},
			);

			// Process guidance request with navigator (not a review)
			const _navResp: any = await this.navigator.processDriverMessage(
				combinedMessage,
				false,
			);
			const navCommands: any[] = Array.isArray(_navResp)
				? _navResp
				: _navResp
					? [_navResp]
					: [];

			// Check for session end in guidance response
			let shouldEnd = false;
			let endReason: string | undefined;
			for (const cmd of navCommands) {
				if (Navigator.shouldEndSession(cmd)) {
					shouldEnd = true;
					endReason = cmd.comment;
				}
			}

			if (shouldEnd) {
				this.logger.logEvent("IMPLEMENTATION_LOOP_COMPLETED", {
					reason: endReason || "Session completed by navigator",
				});
				this.display.setPhase("complete");
				return {
					awaitingResponse: false,
					shouldEnd: true,
					endReason,
				};
			}

			// Provide guidance and continue
			this.display.showTransfer("navigator", "driver", "Guidance");
			this.display.updateStatus("Providing guidance to driver");
			const guidanceMessage =
				"Continue with your implementation based on the guidance provided.";
			const newDriverMessages =
				await this.driver.continueWithFeedback(guidanceMessage);
			const awaitingResponse =
				(newDriverMessages || []).length === 0 ||
				(newDriverMessages || []).every((msg) => !msg || !msg.trim());

			return {
				awaitingResponse,
				shouldEnd: false,
				driverMessages: newDriverMessages,
			};
		}

		return { awaitingResponse: true, shouldEnd: false };
	}

	// Heuristic to detect that the driver believes implementation is complete and intends to request review
	private detectsCompletionIntent(text: string): boolean {
		if (!text) return false;
		const signals = [
			"implementation is complete",
			"i have completed",
			"finished implementation",
			"ready for review",
			"request a review",
			"should now request a review",
			"please review my work",
		];
		return signals.some((s) => text.includes(s));
	}

	addToDriverBuffer(message: string): void {
		this.driverBuffer.push(message);
	}

	clearDriverBuffer(): void {
		this.driverBuffer = [];
	}

	getDriverBufferTranscript(): string {
		const transcript = this.driverBuffer.join("\n").trim();
		this.driverBuffer = [];
		return transcript;
	}

	cleanup(): void {
		if (this.sessionTimer) {
			clearTimeout(this.sessionTimer);
			this.sessionTimer = undefined;
		}
	}
}
