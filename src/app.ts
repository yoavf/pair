/**
 * Main application class for Pair programming orchestrator
 */

import os from "node:os";
import path from "node:path";
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
import type { AppConfig } from "./utils/config.js";
import { EventHandlersManager } from "./utils/eventHandlers.js";
import {
	ImplementationLoop,
	type ImplementationLoopConfig,
} from "./utils/implementationLoop.js";
import { Logger } from "./utils/logger.js";
import { PermissionHandler } from "./utils/permissionHandler.js";

/**
 * Resolve project path with home directory expansion
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

export class PairApp {
	private architect!: Architect;
	private navigator!: Navigator;
	private driver!: Driver;
	private display!: InkDisplayManager;
	private logger: Logger;
	private config = DEFAULT_PAIR_CONFIG;
	private stopping = false;
	private appConfig!: AppConfig;
	private mcp?: PairMcpServer;
	private projectPath!: string;
	private providers: AgentProvider[] = [];
	private implementationLoop!: ImplementationLoop;
	private permissionHandler!: PermissionHandler;
	private eventHandlers!: EventHandlersManager;

	constructor(
		projectPath: string,
		private task: string,
		appConfig: AppConfig,
	) {
		this.appConfig = appConfig;

		const normalizedProjectPath = resolveProjectPath(projectPath);
		this.projectPath = normalizedProjectPath;

		this.config.projectPath = normalizedProjectPath;
		this.config.initialTask = task;

		this.logger = new Logger("pair-debug.log");
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

		const makeProviderConfig = (
			provider: string,
			model?: string,
		): ProviderConfig => ({
			type: provider,
			model,
		});

		// Create providers for all agents
		const architectProvider = agentProviderFactory.createProvider(
			makeProviderConfig(
				this.appConfig.architectConfig.provider,
				this.appConfig.architectConfig.model,
			),
		) as EmbeddedAgentProvider;
		this.providers.push(architectProvider);

		const navigatorProvider = agentProviderFactory.createProvider(
			makeProviderConfig(
				this.appConfig.navigatorConfig.provider,
				this.appConfig.navigatorConfig.model,
			),
		) as EmbeddedAgentProvider;
		this.providers.push(navigatorProvider);

		const driverProvider = agentProviderFactory.createProvider(
			makeProviderConfig(
				this.appConfig.driverConfig.provider,
				this.appConfig.driverConfig.model,
			),
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
			"", // Architect doesn't use MCP server for this approach
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

		// Initialize permission handler
		this.permissionHandler = new PermissionHandler(
			this.navigator,
			this.display,
			this.logger,
		);

		// Create a buffer for driver transcript that can be accessed by permission handler
		let driverBuffer: string[] = [];
		const getDriverTranscript = () => {
			const transcript = driverBuffer.join("\n").trim();
			driverBuffer = [];
			return transcript;
		};

		// Permission broker: canUseTool handler wired to Navigator
		const canUseTool =
			this.permissionHandler.createCanUseToolHandler(getDriverTranscript);

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

		// Initialize implementation loop after driver is created
		const loopConfig: ImplementationLoopConfig = {
			sessionHardLimitMs: this.appConfig.sessionHardLimitMs,
			driverMaxTurns: this.appConfig.driverMaxTurns,
		};
		this.implementationLoop = new ImplementationLoop(
			this.driver,
			this.navigator,
			this.display,
			this.logger,
			loopConfig,
			(message) => this.stopAllAndExit(message),
		);

		// Initialize event handlers
		this.eventHandlers = new EventHandlersManager(
			this.architect,
			this.navigator,
			this.driver,
			this.display,
			this.logger,
			(message) => {
				driverBuffer.push(message);
				this.implementationLoop.addToDriverBuffer(message);
			},
		);
		this.eventHandlers.setup();

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
			await this.implementationLoop.run(this.task, plan);
			this.logger.logEvent("APP_IMPLEMENTATION_LOOP_COMPLETED", {});

			// Implementation loop completed - this should only happen when task is done
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
	 * Clean up resources
	 */
	private async cleanup(): Promise<void> {
		this.display?.cleanup();
		this.implementationLoop?.cleanup();

		// Clean up MCP server first
		try {
			if (this.mcp) {
				await this.mcp.close();
			}
		} catch (error) {
			this.logger?.logEvent("MCP_CLOSE_ERROR", {
				error: error instanceof Error ? error.message : String(error),
			});
		}

		// Clean up providers
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

		// Close logger last to avoid write-after-end errors
		this.logger?.close();
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
