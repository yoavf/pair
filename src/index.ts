#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import {
	DEFAULT_PAIR_CONFIG,
	DRIVER_PROMPT,
	MONITORING_NAVIGATOR_PROMPT,
	PLANNING_NAVIGATOR_PROMPT,
	TURN_LIMITS,
} from "./config.js";
import { Architect } from "./conversations/Architect.js";
import { Driver } from "./conversations/Driver.js";
import { Navigator } from "./conversations/Navigator.js";
import { InkDisplayManager } from "./display.js";
import { type PairMcpServer, startPairMcpServer } from "./mcp/httpServer.js";
import { agentProviderFactory } from "./providers/factory.js";
import type {
	AgentProvider,
	EmbeddedAgentProvider,
	ProviderConfig,
} from "./providers/types.js";
import { isEmbeddedProvider } from "./providers/types.js";
import { isFileModificationTool } from "./types/core.js";
import {
	NavigatorSessionError,
	PermissionDeniedError,
	PermissionMalformedError,
	PermissionTimeoutError,
} from "./types/errors.js";
import type { PermissionRequest } from "./types/permission.js";
import type { NavigatorCommand } from "./types.js";
import { displayBanner } from "./utils/banner.js";
import { type AppConfig, loadConfig, validateConfig } from "./utils/config.js";
import { Logger } from "./utils/logger.js";
import { TIMEOUT_CONFIG, TimeoutManager } from "./utils/timeouts.js";
import {
	ValidationError,
	validateAndReadPromptFile,
	validateAndSanitizePath,
	validateCliArgs,
	validatePrompt,
} from "./utils/validation.js";
import { getVersion } from "./utils/version.js";

/**
 * Claude pair programming orchestrator
 */
function resolveProjectPath(projectPath: string): string {
	const trimmed = projectPath?.trim() ?? "";
	if (!trimmed) {
		return process.cwd();
	}
	let expanded = trimmed;
	if (expanded === "~") {
		expanded = os.homedir();
	} else if (expanded.startsWith("~/")) {
		expanded = path.join(os.homedir(), expanded.slice(2));
	}
	return path.resolve(expanded);
}

class ClaudePairApp {
	private architect!: Architect;
	private navigator!: Navigator;
	private driver!: Driver;
	private display!: InkDisplayManager;
	private logger: Logger;
	private config = DEFAULT_PAIR_CONFIG;
	private stopping = false;
	private appConfig!: AppConfig;
	private sessionTimer?: NodeJS.Timeout;
	private mcp?: PairMcpServer;
	// Removed idle watchdog to minimize UI noise
	private driverBuffer: string[] = [];
	private projectPath!: string;
	// Follow-up prompting handled at end of each cycle
	// No nudge counters; a per-iteration buffer flush prevents growth
	private providers: AgentProvider[] = [];

	// driverBuffer holds a short transcript of recent driver actions
	// It is flushed on permission checks and at the end of each iteration

	private async requestPermissionWithTimeout(
		request: PermissionRequest,
		timeoutMs = TIMEOUT_CONFIG.PERMISSION_REQUEST,
	) {
		const { controller, cleanup } = TimeoutManager.createTimeout(timeoutMs);

		try {
			const result = await this.navigator.reviewPermission(request, {
				signal: controller.signal,
			});
			cleanup();
			return result;
		} catch (error) {
			cleanup();

			if (error instanceof PermissionDeniedError) {
				return {
					allowed: false as const,
					reason: error.reason,
				};
			}

			if (error instanceof PermissionTimeoutError) {
				this.logger.logEvent("PERMISSION_TIMEOUT", {
					toolName: request.toolName,
					timeoutMs,
				});
				return {
					allowed: false as const,
					reason: "Permission request timed out",
				};
			}

			if (error instanceof PermissionMalformedError) {
				this.logger.logEvent("PERMISSION_MALFORMED", {
					toolName: request.toolName,
					error: error.message,
				});
				return {
					allowed: false as const,
					reason: "Navigator provided invalid response",
				};
			}

			if (error instanceof NavigatorSessionError) {
				this.logger.logEvent("PERMISSION_SESSION_ERROR", {
					toolName: request.toolName,
					error: error.message,
				});
				return {
					allowed: false as const,
					reason: "Navigator session error",
				};
			}

			if (controller.signal.aborted) {
				this.logger.logEvent("PERMISSION_ABORTED", {
					toolName: request.toolName,
				});
				return {
					allowed: false as const,
					reason: "Permission request was cancelled",
				};
			}

			this.logger.logEvent("PERMISSION_UNKNOWN_ERROR", {
				toolName: request.toolName,
				error: error instanceof Error ? error.message : String(error),
			});
			return {
				allowed: false as const,
				reason: "Unknown error occurred",
			};
		}
	}

	constructor(
		projectPath: string,
		private task: string,
	) {
		const appConfig = loadConfig();
		validateConfig(appConfig, agentProviderFactory.getAvailableProviders());
		this.appConfig = appConfig;

		const normalizedProjectPath = resolveProjectPath(projectPath);
		this.projectPath = normalizedProjectPath;

		this.config.projectPath = normalizedProjectPath;
		this.config.initialTask = task;

		this.logger = new Logger("claude-pair-debug.log");
		const logPath = this.logger.getFilePath();
		this.logger.logEvent("APP_LOGGING_CONFIG", {
			level: process.env.LOG_LEVEL || "(disabled)",
			file: logPath || "(none)",
		});
	}

	/**
	 * Start the application
	 */
	async start(): Promise<void> {
		// Initialize display
		this.display = new InkDisplayManager();
		this.display.start(this.projectPath, this.task, this.appConfig, () => {
			this.stopAllAndExit();
		});

		// Start the single-process HTTP/SSE MCP server (two paths) and wire agents to it
		this.logger.logEvent("APP_MCP_STARTING", {});
		this.mcp = await startPairMcpServer(undefined, this.logger);
		const navUrl = this.mcp.urls.navigator;
		const drvUrl = this.mcp.urls.driver;
		this.logger.logEvent("APP_MCP_URLS", { navUrl, drvUrl });

		const makeProviderConfig = (providerType: string): ProviderConfig => {
			if (providerType === "opencode") {
				return {
					type: providerType,
					options: {
						mcpServers: {
							"pair-navigator": { url: navUrl },
							"pair-driver": { url: drvUrl },
						},
					},
				};
			}
			return { type: providerType };
		};

		// Create providers for all agents
		const architectProvider = agentProviderFactory.createProvider(
			makeProviderConfig(this.appConfig.architectProvider),
		) as EmbeddedAgentProvider;
		this.providers.push(architectProvider);

		const navigatorProvider = agentProviderFactory.createProvider(
			makeProviderConfig(this.appConfig.navigatorProvider),
		) as EmbeddedAgentProvider;
		this.providers.push(navigatorProvider);

		const driverProvider = agentProviderFactory.createProvider(
			makeProviderConfig(this.appConfig.driverProvider),
		) as EmbeddedAgentProvider;
		this.providers.push(driverProvider);

		// Create agents with providers
		this.architect = new Architect(
			PLANNING_NAVIGATOR_PROMPT,
			["Read", "Grep", "Glob", "WebSearch", "WebFetch", "TodoWrite", "Bash"],
			TURN_LIMITS.ARCHITECT,
			this.projectPath,
			this.logger,
			architectProvider,
			// Architect doesn't use MCP server, but we can pass empty string
			"",
		);

		this.navigator = new Navigator(
			MONITORING_NAVIGATOR_PROMPT,
			// Read-only tools + Bash(git diff/*, git status/*) and TodoWrite for status
			[
				"Read",
				"Grep",
				"Glob",
				"WebSearch",
				"WebFetch",
				"Bash(git diff:*)",
				"Bash(git status:*)",
				"Bash(git show:*)",
				"TodoWrite",
			],
			this.appConfig.navigatorMaxTurns,
			this.projectPath,
			this.logger,
			navigatorProvider,
			navUrl,
		);

		// Permission broker: canUseTool handler wired to Navigator
		const canUseTool = async (
			toolName: string,
			input: Record<string, unknown>,
			_options?: { suggestions?: Record<string, unknown> },
		): Promise<
			| {
					behavior: "allow";
					updatedInput: Record<string, unknown>;
					updatedPermissions?: Record<string, unknown>;
			  }
			| { behavior: "deny"; message: string }
		> => {
			const needsApproval = isFileModificationTool(toolName);

			if (!needsApproval) {
				return { behavior: "allow", updatedInput: input };
			}
			// Flush buffered driver transcript
			const transcript = this.driverBuffer.join("\n").trim();
			this.driverBuffer = [];
			// Display transfer to navigator for permission
			this.display?.showTransfer("driver", "navigator", "Permission request");
			this.display?.updateStatus(`Awaiting navigator approval: ${toolName}`);
			this.logger.logEvent("PERMISSION_REQUEST_SENT", {
				toolName,
				inputKeys: Object.keys(input || {}),
				transcriptPreview: transcript.slice(0, 200),
			});

			const result = await this.requestPermissionWithTimeout({
				driverTranscript: transcript,
				toolName,
				input,
			});

			this.display?.showTransfer("navigator", "driver", "Decision");
			this.display?.updateStatus(
				result.allowed ? `Approved: ${toolName}` : `Denied: ${toolName}`,
			);
			this.logger.logEvent("PERMISSION_DECISION", {
				toolName,
				allowed: result.allowed,
			});

			if (!result.allowed) {
				return {
					behavior: "deny",
					message: result.reason,
				};
			}

			return {
				behavior: "allow",
				updatedInput: result.updatedInput,
			};
		};

		this.driver = new Driver(
			DRIVER_PROMPT,
			["all"],
			this.appConfig.driverMaxTurns,
			this.projectPath,
			this.logger,
			driverProvider,
			canUseTool,
			drvUrl,
		);

		this.setupEventHandlers();

		try {
			this.logger.logEvent("APP_ARCHITECT_STARTING", {
				task: this.task.substring(0, 100),
			});
			const plan = await this.architect.createPlan(this.task);
			this.logger.logEvent("APP_ARCHITECT_RETURNED", {
				hasPlan: !!plan,
				planLength: plan?.length || 0,
			});

			if (!plan) {
				this.logger.logEvent("APP_PLAN_CREATION_FAILED", {
					task: this.task.substring(0, 100),
				});
				await this.cleanup();
				return;
			}

			this.logger.logEvent("APP_PLAN_CREATED_SUCCESS", {
				planLength: plan.length,
			});
			this.logger.logEvent("APP_SHOWING_PLAN", {});
			this.display.showPlan(plan);
			this.logger.logEvent("APP_PLAN_SHOWN", {});

			this.logger.logEvent("APP_PLAN_PHASE_COMPLETE", {});
			this.display.setPhase("execution");

			// Show transition message before starting implementation
			this.display.showTransitionMessage();

			// Phase 2 & 3: Run implementation loop
			this.logger.logEvent("APP_STARTING_IMPLEMENTATION_LOOP", {
				planLength: plan.length,
			});
			await this.runImplementationLoop(plan);
			this.logger.logEvent("APP_IMPLEMENTATION_LOOP_COMPLETED", {});

			// Implementation loop completed - this should only happen when task is done
			if (this.sessionTimer) clearTimeout(this.sessionTimer);
			await this.cleanup();
			return; // Graceful end without forcing process exit
		} catch (error) {
			this.logger.logEvent("APP_START_FAILED", {
				error: error instanceof Error ? error.message : String(error),
			});
			console.error("Failed to start:", error);
			await this.cleanup();
			return; // Do not hard-exit
		}
	}

	/**
	 * Run the implementation loop between driver and navigator
	 */
	private async runImplementationLoop(plan: string): Promise<void> {
		// Set hard session time limit
		const limitMs = this.appConfig.sessionHardLimitMs;
		const deadline = Date.now() + limitMs;
		this.sessionTimer = setTimeout(() => {
			try {
				this.logger.logEvent("IMPLEMENTATION_HARD_LIMIT_REACHED", {
					limitMs,
				});
				this.display.updateStatus(
					`⏲️ Session limit reached (${Math.floor(limitMs / 60000)}m) — stopping...`,
				);
				void this.stopAllAndExit();
			} catch {}
		}, limitMs);
		// Initialize navigator with plan context
		this.logger.logEvent("IMPLEMENTATION_LOOP_NAVIGATOR_INIT_START", {});
		await this.navigator.initialize(this.task, plan);
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

			// Guardrail: if driver text indicates completion intent but no review tool was called, nudge to request review immediately
			if (!dcType && !awaitingReviewDecision) {
				const combinedDriverText = (driverMessages || [])
					.join("\n")
					.toLowerCase();
				if (ClaudePairApp.detectsCompletionIntent(combinedDriverText)) {
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
				awaitingReviewDecision = true;
				this.logger.logEvent("IMPLEMENTATION_LOOP_REVIEW_REQUESTED", {});
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
					this.logger.logEvent(
						"IMPLEMENTATION_LOOP_SENDING_REVIEW_TO_NAVIGATOR",
						{
							messageLength: messageForNavigator.length,
						},
					);
					// biome-ignore lint/suspicious/noExplicitAny: Navigator command response type from Claude Code SDK
					const _navResp: any =
						await this.navigator.processDriverMessage(messageForNavigator);
					// biome-ignore lint/suspicious/noExplicitAny: Navigator command array type from Claude Code SDK
					const navCommands: any[] = Array.isArray(_navResp)
						? _navResp
						: _navResp
							? [_navResp]
							: [];

					if (navCommands.length > 0) {
						awaitingReviewDecision = false;
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
								endSummary =
									cmd.type === "complete" ? cmd.summary : cmd.comment;
							}
						}

						if (reviewComments && !shouldEnd) {
							this.logger.logEvent(
								"IMPLEMENTATION_LOOP_NAVIGATOR_REVIEW_COMMENTS",
								{
									commentsLength: reviewComments.length,
								},
							);
							this.display.showTransfer(
								"navigator",
								"driver",
								"Review comments",
							);
							this.display.setPhase("execution");
							driverMessages =
								await this.driver.continueWithFeedback(reviewComments);
							continue;
						}

						if (shouldEnd) {
							this.logger.logEvent("IMPLEMENTATION_LOOP_COMPLETED", {
								summary: endSummary || "Implementation finished",
							});
							this.display.setPhase("complete");
							await this.stopAllAndExit(endSummary);
							return;
						}
					} else {
						// If no commands, re-prompt the navigator until we get a decision (bounded retries)
						this.display.updateStatus("Waiting for review decision…");
						let attempts = 0;
						while (attempts < 5) {
							attempts++;
							const retryPrompt = `${messageForNavigator}\n\nSTRICT: Respond with exactly one MCP tool call: mcp__navigator__navigatorCodeReview OR mcp__navigator__navigatorComplete. No other text.`;
							const retryResp =
								await this.navigator.processDriverMessage(retryPrompt);
							const cmds: NavigatorCommand[] = Array.isArray(retryResp)
								? retryResp
								: retryResp
									? [retryResp]
									: [];
							if (cmds.length > 0) {
								const reviewParts: string[] = [];
								let shouldEnd = false;
								let endSummary: string | undefined;
								for (const cmd of cmds) {
									this.logger.logEvent(
										"IMPLEMENTATION_LOOP_NAVIGATOR_COMMAND",
										{
											commandType: cmd.type,
											hasComment: !!cmd.comment,
											pass: cmd.pass,
										},
									);

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
										endSummary =
											cmd.type === "complete" ? cmd.summary : cmd.comment;
									}
								}

								if (reviewParts.length > 0 && !shouldEnd) {
									const reviewMessage = reviewParts.join("\n\n");
									this.display.showTransfer(
										"navigator",
										"driver",
										"Review comments",
									);
									this.display.setPhase("execution");
									driverMessages =
										await this.driver.continueWithFeedback(reviewMessage);
									break;
								}

								if (shouldEnd) {
									this.logger.logEvent("IMPLEMENTATION_LOOP_COMPLETED", {
										summary: endSummary || "Implementation finished",
									});
									this.display.setPhase("complete");
									await this.stopAllAndExit(endSummary);
									return;
								}
								break;
							}
							await new Promise((r) => setTimeout(r, 1000));
						}
						if (attempts >= 5) {
							this.logger.logEvent(
								"IMPLEMENTATION_LOOP_NAVIGATOR_EMPTY_DECISION",
								{},
							);
						}
					}
					continue; // Next loop
				}

				// Default path: simply continue (unless we're waiting on a review decision or guidance follow-up)
				if (awaitingReviewDecision || awaitingDriverResponseAfterGuidance) {
					await new Promise((resolve) => setTimeout(resolve, 500));
					continue;
				}
				this.driverBuffer = [];
				driverMessages =
					await this.driver.continueWithFeedback("Please continue.");
			} else if (dcType === "request_guidance") {
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
					// Process guidance request with navigator
					const _navResp: any =
						await this.navigator.processDriverMessage(combinedMessage);
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
							endReason = cmd.type === "complete" ? cmd.summary : cmd.comment;
						}
					}

					if (shouldEnd) {
						awaitingDriverResponseAfterGuidance = false;
						this.logger.logEvent("IMPLEMENTATION_LOOP_COMPLETED", {
							reason: endReason || "Session completed by navigator",
						});
						this.display.setPhase("complete");
						await this.stopAllAndExit(endReason);
						return;
					}

					// Provide guidance and continue
					this.display.showTransfer("navigator", "driver", "Guidance");
					this.display.updateStatus("Providing guidance to driver");
					const guidanceMessage =
						"Continue with your implementation based on the guidance provided.";
					driverMessages =
						await this.driver.continueWithFeedback(guidanceMessage);
					awaitingDriverResponseAfterGuidance =
						(driverMessages || []).length === 0 ||
						(driverMessages || []).every((msg) => !msg || !msg.trim());
					continue;
				}
				awaitingDriverResponseAfterGuidance = true;
			} else {
				// Empty batch received. Brief backoff, then continue.
				this.logger.logEvent("IMPLEMENTATION_LOOP_EMPTY_BATCH", {});
				await new Promise((r) => setTimeout(r, 300));
				driverMessages = await this.driver.continueWithFeedback(
					"Please continue with the next step.",
				);
				this.driverBuffer = [];
			}
		}
	}

	// Heuristic to detect that the driver believes implementation is complete and intends to request review
	private static detectsCompletionIntent(text: string): boolean {
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

	/**
	 * Set up event handlers for display
	 */
	private setupEventHandlers(): void {
		// Architect events
		this.architect.on("message", (message) => {
			this.display.showArchitectTurn(message.content);
		});

		this.architect.on("tool_use", ({ tool, input }) => {
			this.display.showToolUse("architect", tool, input);
			this.logger.logEvent("ARCHITECT_TOOL_USE", {
				tool,
				inputKeys: Object.keys(input || {}),
			});
		});

		// Navigator events
		this.navigator.on("message", (message) => {
			if (this.display.getPhase && this.display.getPhase() === "complete") {
				return;
			}
			this.display.showNavigatorTurn(message.content);
		});

		this.navigator.on("tool_use", ({ tool, input }) => {
			this.display.showToolUse("navigator", tool, input);
			this.logger.logEvent("NAVIGATOR_TOOL_USE", {
				tool,
				inputKeys: Object.keys(input || {}),
			});
		});

		// No queued indicator; we'll annotate on send

		// Driver events
		this.driver.on("message", (message) => {
			this.display.showDriverTurn(message.content);
			// Buffer for permission bulk-forwarding
			const t = (message.content || "").trim();
			if (t) this.driverBuffer.push(t);
		});

		// Minimal: no status line for driver system notifications

		this.driver.on("tool_use", ({ tool, input }) => {
			this.display.showToolUse("driver", tool, input);
			this.logger.logEvent("DRIVER_TOOL_USE", {
				tool,
				inputKeys: Object.keys(input || {}),
			});
			// Summarize tool usage line for buffered transcript
			try {
				const file = input?.file_path || input?.path || "";
				const cmd = input?.command || "";
				const line =
					tool === "Bash" && cmd
						? `⚙️  Tool: Bash - ${String(cmd)}`
						: file
							? `⚙️  Tool: ${tool} - ${file}`
							: `⚙️  Tool: ${tool}`;
				this.driverBuffer.push(line);
				// No status line here; tool usage is already shown in chat
			} catch {}
		});

		// No batch completion status line to keep UI minimal
	}

	/**
	 * Clean up resources
	 */
	private async cleanup(): Promise<void> {
		this.display?.cleanup();
		this.logger?.close();
		if (this.sessionTimer) clearTimeout(this.sessionTimer);
		try {
			if (this.mcp) {
				await this.mcp.close();
			}
		} catch (error) {
			this.logger?.logEvent("MCP_CLOSE_ERROR", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
		if (this.providers.length > 0) {
			await Promise.allSettled(
				this.providers.map((provider) =>
					provider.cleanup
						? provider.cleanup().catch((error) => {
								this.logger?.logEvent("PROVIDER_CLEANUP_ERROR", {
									provider: provider.name,
									error: error instanceof Error ? error.message : String(error),
								});
							})
						: Promise.resolve(),
				),
			);
		}
	}

	private async stopAllAndExit(completionMessage?: string): Promise<void> {
		if (this.stopping) return;
		this.stopping = true;
		if (completionMessage) {
			this.display.showCompletionMessage(completionMessage);
		}
		try {
			await Promise.allSettled([this.driver.stop(), this.navigator.stop()]);
		} catch {}
		await this.cleanup();
		process.exit(0);
	}
}

/**
 * Display help message
 */
function showHelp(): void {
	console.log("Usage: pair claude [options]");
	console.log("\nAvailable options:");
	console.log("  -p, --prompt <text>    Specify the task prompt");
	console.log(
		"  --path <path>          Set the project path (default: current directory)",
	);
	console.log("  -f, --file <file>      Read prompt from file");
	console.log("  --version              Show version information");
	console.log("  --help                 Show this help message");
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
	try {
		const config = loadConfig();
		validateConfig(config, agentProviderFactory.getAvailableProviders());

		const args = process.argv.slice(2);

		// Handle global --version flag
		if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
			console.log(getVersion());
			process.exit(0);
		}

		// Handle global --help flag
		if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
			showHelp();
			process.exit(0);
		}

		// Handle 'pair help' command
		if (args.length === 1 && args[0] === "help") {
			showHelp();
			process.exit(0);
		}

		// Check if first argument is 'claude' subcommand
		if (args.length === 0 || args[0] !== "claude") {
			// This is an actual error case (no args or invalid subcommand)
			displayBanner();
			console.error("Usage: pair claude [options]");
			console.error("\nAvailable options:");
			console.error("  -p, --prompt <text>    Specify the task prompt");
			console.error(
				"  --path <path>          Set the project path (default: current directory)",
			);
			console.error("  -f, --file <file>      Read prompt from file");
			console.error("  --version              Show version information");
			console.error("  --help                 Show this help message");
			process.exit(1);
		}

		// Remove 'claude' subcommand and proceed with remaining args
		const claudeArgs = args.slice(1);

		// Handle --version within claude subcommand (before banner)
		if (claudeArgs.includes("--version") || claudeArgs.includes("-v")) {
			console.log(getVersion());
			process.exit(0);
		}

		// Handle --help within claude subcommand (before banner)
		if (claudeArgs.includes("--help") || claudeArgs.includes("-h")) {
			showHelp();
			process.exit(0);
		}

		// Display banner for normal operations
		displayBanner();

		validateCliArgs(claudeArgs);

		let projectPath = process.cwd();
		let initialPrompt: string | undefined;
		let promptFile: string | undefined;
		// Parse arguments
		for (let i = 0; i < claudeArgs.length; i++) {
			const arg = claudeArgs[i];

			if (arg === "--path") {
				if (i + 1 < claudeArgs.length) {
					projectPath = claudeArgs[i + 1];
					i++;
				}
			} else if (arg.startsWith("--path=")) {
				projectPath = arg.split("=")[1];
			} else if (arg === "--prompt" || arg === "-p") {
				if (i + 1 < claudeArgs.length) {
					initialPrompt = claudeArgs[i + 1];
					i++;
				}
			} else if (arg.startsWith("--prompt=")) {
				initialPrompt = arg.substring("--prompt=".length);
			} else if (arg === "--file" || arg === "-f") {
				if (i + 1 < claudeArgs.length) {
					promptFile = claudeArgs[i + 1];
					i++;
				}
			} else if (arg.startsWith("--file=")) {
				promptFile = arg.split("=")[1];
			} else if (!arg.startsWith("-")) {
				if (projectPath === process.cwd()) {
					projectPath = arg;
				}
			}
		}

		// Validate project path
		projectPath = validateAndSanitizePath(projectPath);

		// Get task
		let task: string;

		if (promptFile) {
			task = validateAndReadPromptFile(promptFile);
		} else if (initialPrompt) {
			task = validatePrompt(initialPrompt, config.maxPromptLength);
		} else {
			task = await getTaskFromUser();
		}

		// Create and start app
		const app = new ClaudePairApp(projectPath, task);
		await app.start();
	} catch (error) {
		if (error instanceof ValidationError) {
			console.error(`❌ ${error.message}`);
		} else {
			console.error("❌ Fatal error:", error);
		}
	}
}

/**
 * Get task from user input
 */
async function getTaskFromUser(): Promise<string> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question("Enter the task for Claude to pair code on:\n> ", (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

// Start the application
main();
