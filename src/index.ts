#!/usr/bin/env node

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
import { displayBanner } from "./utils/banner.js";
import { type AppConfig, loadConfig, validateConfig } from "./utils/config.js";
import { Logger } from "./utils/logger.js";
import type { NavigatorCommand } from "./utils/navigatorCommands.js";
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
	// Removed idle watchdog to minimize UI noise
	private driverBuffer: string[] = [];

	constructor(
		private projectPath: string,
		private task: string,
	) {
		const appConfig = loadConfig();
		validateConfig(appConfig);
		this.appConfig = appConfig;

		this.config.projectPath = projectPath;
		this.config.initialTask = task;

		this.logger = new Logger("claude-pair-debug.log");

		// Create simple agents
		this.architect = new Architect(
			PLANNING_NAVIGATOR_PROMPT,
			["Read", "Grep", "Glob", "WebSearch", "WebFetch", "TodoWrite", "Bash"],
			TURN_LIMITS.ARCHITECT,
			projectPath,
			this.logger,
		);

		this.navigator = new Navigator(
			MONITORING_NAVIGATOR_PROMPT,
			// Read-only tool set for visibility without making changes
			["Read", "Grep", "Glob", "WebSearch", "WebFetch", "Bash", "TodoWrite"],
			this.appConfig.navigatorMaxTurns,
			projectPath,
			this.logger,
		);

		// Permission broker: canUseTool handler wired to Navigator
		const canUseTool = async (
			toolName: string,
			input: Record<string, unknown>,
			options?: { suggestions?: Record<string, unknown> },
		): Promise<
			| {
					behavior: "allow";
					updatedInput: Record<string, unknown>;
					updatedPermissions?: Record<string, unknown>;
			  }
			| { behavior: "deny"; message: string; interrupt?: boolean }
		> => {
			const needsApproval =
				toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit";
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
			const decision = await this.navigator.reviewPermission(
				transcript,
				toolName,
				input,
			);
			this.display?.showTransfer("navigator", "driver", "Decision");
			this.display?.updateStatus(
				decision.allow
					? decision.alwaysAllow
						? `Approved (always): ${toolName}`
						: `Approved: ${toolName}`
					: `Denied: ${toolName}`,
			);
			this.logger.logEvent("PERMISSION_DECISION", {
				toolName,
				allow: decision.allow,
				comment: decision.comment,
			});
			if (!decision.allow) {
				// Inform the driver why the request was denied so it can adjust
				const msg = decision.comment
					? `Permission denied for ${toolName}: ${decision.comment}`
					: `Permission denied for ${toolName}. Please adjust your approach and try again.`;
				this.driver.pushNavigatorFeedback(msg);
				return {
					behavior: "deny",
					message: decision.comment || "Navigator denied tool usage",
					interrupt: false,
				};
			}
			// Do not inject approval comments; approvals are implicit
			// If navigator provided actionable feedback, forward it to the driver
			if (decision.feedback && decision.feedback.trim().length > 0) {
				this.driver.pushNavigatorFeedback(decision.feedback.trim());
			}
			// If navigator opted for always-allow and SDK provided suggestions, pass them back
			const updatedPermissions = decision.alwaysAllow
				? options?.suggestions
				: undefined;
			return {
				behavior: "allow",
				updatedInput: decision.updatedInput ?? input,
				// biome-ignore lint/suspicious/noExplicitAny: SDK will validate structure
				updatedPermissions: updatedPermissions as any,
			};
		};

		this.driver = new Driver(
			DRIVER_PROMPT,
			["all"],
			this.appConfig.driverMaxTurns,
			projectPath,
			this.logger,
			canUseTool,
		);

		this.setupEventHandlers();
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
				this.cleanup();
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
			this.cleanup();
			return; // Graceful end without forcing process exit
		} catch (error) {
			this.logger.logEvent("APP_START_FAILED", {
				error: error instanceof Error ? error.message : String(error),
			});
			console.error("Failed to start:", error);
			this.cleanup();
			return; // Do not hard-exit
		}
	}

	/**
	 * Run the implementation loop between driver and navigator
	 */
	private async runImplementationLoop(plan: string): Promise<void> {
		try {
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
			this.logger.logEvent("IMPLEMENTATION_LOOP_DRIVER_INITIAL_MESSAGES", {
				messageCount: driverMessages.length,
			});

			// Main implementation loop
			let loopCount = 0;
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

				// Check if driver requested review or guidance in its recent output
				const driverCommand = Driver.hasRequestReview(driverMessages);
				const dcType = driverCommand?.type as string | undefined;
				if (dcType === "request_review") {
					this.logger.logEvent("IMPLEMENTATION_LOOP_REVIEW_REQUESTED", {});
					const combinedMessage = Driver.combineMessagesForNavigator([
						...this.driverBuffer,
						...driverMessages,
					]);
					this.driverBuffer = [];
					if (combinedMessage) {
						this.display.showTransfer("driver", "navigator", "Review request");
						this.logger.logEvent(
							"IMPLEMENTATION_LOOP_SENDING_REVIEW_TO_NAVIGATOR",
							{
								messageLength: combinedMessage.length,
							},
						);
						// biome-ignore lint/suspicious/noExplicitAny: Navigator command response type from Claude Code SDK
						const _navResp: any =
							await this.navigator.processDriverMessage(combinedMessage);
						// biome-ignore lint/suspicious/noExplicitAny: Navigator command array type from Claude Code SDK
						const navCommands: any[] = Array.isArray(_navResp)
							? _navResp
							: _navResp
								? [_navResp]
								: [];

						if (navCommands.length > 0) {
							for (const cmd of navCommands) {
								this.logger.logEvent("IMPLEMENTATION_LOOP_NAVIGATOR_COMMAND", {
									commandType: cmd.type,
									hasComment: !!cmd.comment,
									pass: cmd.pass,
								});

								if (cmd.type === "code_review") {
									this.display.setPhase("review");
								}

								if (Navigator.shouldEndSession(cmd)) {
									const summary =
										cmd.type === "complete" ? cmd.summary : cmd.comment;
									this.logger.logEvent("IMPLEMENTATION_LOOP_COMPLETED", {
										summary: summary || "Implementation finished",
									});
									this.display.setPhase("complete");
									await this.stopAllAndExit();
									return;
								}

								const feedback = Navigator.extractFeedbackForDriver(cmd);
								if (!feedback || feedback.trim().length === 0) {
									continue;
								}

								this.logger.logEvent("IMPLEMENTATION_LOOP_NAVIGATOR_FEEDBACK", {
									feedbackLength: feedback.length,
								});
								this.display.showTransfer(
									"navigator",
									"driver",
									"Review feedback",
								);
								this.display.setPhase("execution");
								driverMessages =
									await this.driver.continueWithFeedback(feedback);
							}
						} else {
							// If no commands, re-prompt the navigator until we get a decision (bounded retries)
							this.display.updateStatus("Waiting for review decision…");
							let attempts = 0;
							while (attempts < 5) {
								attempts++;
								const retryResp = await this.navigator.processDriverMessage(
									"STRICT: Respond with exactly one tag: {{CodeReview ...}} or {{Complete ...}}",
								);
								const cmds: NavigatorCommand[] = Array.isArray(retryResp)
									? retryResp
									: retryResp
										? [retryResp]
										: [];
								if (cmds.length > 0) {
									for (const cmd of cmds) {
										this.logger.logEvent(
											"IMPLEMENTATION_LOOP_NAVIGATOR_COMMAND",
											{
												commandType: cmd.type,
												hasComment: !!cmd.comment,
												pass: cmd.pass,
											},
										);

										if (cmd.type === "code_review")
											this.display.setPhase("review");

										if (Navigator.shouldEndSession(cmd)) {
											const summary =
												cmd.type === "complete" ? cmd.summary : cmd.comment;
											this.logger.logEvent("IMPLEMENTATION_LOOP_COMPLETED", {
												summary: summary || "Implementation finished",
											});
											this.display.setPhase("complete");
											await this.stopAllAndExit();
											return;
										}

										const feedback = Navigator.extractFeedbackForDriver(cmd);
										if (feedback && feedback.trim().length > 0) {
											this.display.showTransfer(
												"navigator",
												"driver",
												"Review feedback",
											);
											this.display.setPhase("execution");
											driverMessages =
												await this.driver.continueWithFeedback(feedback);
											break;
										}
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
								driverMessages =
									await this.driver.continueWithFeedback("Please continue.");
							}
						}
						continue; // Next loop
					}

					// Handle guidance requests
					const dcType2 = driverCommand?.type as string | undefined;
					if (dcType2 === "request_guidance") {
						const combinedMessage = Driver.combineMessagesForNavigator([
							...this.driverBuffer,
							...driverMessages,
						]);
						this.driverBuffer = [];
						if (combinedMessage) {
							this.display.showTransfer(
								"driver",
								"navigator",
								"Guidance request",
							);
							const guidance =
								await this.navigator.provideGuidance(combinedMessage);
							if (guidance && guidance.trim().length > 0) {
								this.display.showTransfer("navigator", "driver", "Guidance");
								driverMessages =
									await this.driver.continueWithFeedback(guidance);
								continue;
							}
						}
					}

					// Default path: no navigator involvement; ask driver to continue
					driverMessages =
						await this.driver.continueWithFeedback("Please continue.");
				} else {
					// Empty batch received. Brief backoff, then nudge the driver to continue.
					this.logger.logEvent("IMPLEMENTATION_LOOP_EMPTY_BATCH", {});
					await new Promise((r) => setTimeout(r, 300));
					driverMessages =
						await this.driver.continueWithFeedback("Please continue.");
				}
			}
		} catch (error) {
			this.logger.logEvent("IMPLEMENTATION_LOOP_ERROR", {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});
			throw error;
		}
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
	private cleanup(): void {
		this.display?.cleanup();
		this.logger?.close();
		if (this.sessionTimer) clearTimeout(this.sessionTimer);
		// No idle timer to clear
	}

	private async stopAllAndExit(): Promise<void> {
		if (this.stopping) return;
		this.stopping = true;
		try {
			await Promise.allSettled([this.driver.stop(), this.navigator.stop()]);
		} catch {}
		this.cleanup();
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
		validateConfig(config);

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
