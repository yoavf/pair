/**
 * Configuration management for Pair
 */

import type { ModelConfig } from "../providers/types.js";

export interface AppConfig {
	/** Maximum turns for navigator session */
	navigatorMaxTurns: number;

	/** Maximum turns for driver session */
	driverMaxTurns: number;

	/** Maximum prompt length in characters */
	maxPromptLength: number;

	/** Maximum prompt file size in bytes */
	maxPromptFileSize: number;

	/** Hard time limit for an execution session in milliseconds */
	sessionHardLimitMs: number;

	/** Enable sync status updates in footer (default: true) */
	enableSyncStatus: boolean;

	/** Enable verbose logging for agent communication (default: false) */
	verboseLogging: boolean;

	/** Model configuration for navigator agent */
	navigatorConfig: ModelConfig;

	/** Model configuration for driver agent */
	driverConfig: ModelConfig;
}

export const DEFAULT_CONFIG: AppConfig = {
	navigatorMaxTurns: 50,
	driverMaxTurns: 20,
	maxPromptLength: 10000,
	maxPromptFileSize: 100 * 1024, // 100KB
	sessionHardLimitMs: 30 * 60 * 1000, // 30 minutes
	enableSyncStatus: true, // Enable by default
	verboseLogging: false, // Disable by default
	navigatorConfig: {
		provider: "claude-code",
		model: "claude-opus-4-1-20250805", // Opus 4.1 for both planning and monitoring
	},
	driverConfig: {
		provider: "claude-code",
		model: "claude-sonnet-4-20250514",
	},
};

/**
 * Load configuration from environment variables with fallbacks to defaults
 */
export function loadConfig(): AppConfig {
	const config: AppConfig = {
		navigatorMaxTurns:
			parseInt(process.env.CLAUDE_PAIR_NAVIGATOR_MAX_TURNS || "", 10) ||
			DEFAULT_CONFIG.navigatorMaxTurns,
		driverMaxTurns:
			parseInt(process.env.CLAUDE_PAIR_DRIVER_MAX_TURNS || "", 10) ||
			DEFAULT_CONFIG.driverMaxTurns,
		maxPromptLength:
			parseInt(process.env.CLAUDE_PAIR_MAX_PROMPT_LENGTH || "", 10) ||
			DEFAULT_CONFIG.maxPromptLength,
		maxPromptFileSize:
			parseInt(process.env.CLAUDE_PAIR_MAX_PROMPT_FILE_SIZE || "", 10) ||
			DEFAULT_CONFIG.maxPromptFileSize,
		sessionHardLimitMs:
			(parseInt(process.env.CLAUDE_PAIR_SESSION_HARD_LIMIT_MIN || "", 10) ||
				30) *
			60 *
			1000,
		enableSyncStatus: process.env.CLAUDE_PAIR_DISABLE_SYNC_STATUS !== "true",
		verboseLogging: process.env.CLAUDE_PAIR_VERBOSE === "true",
		navigatorConfig: { ...DEFAULT_CONFIG.navigatorConfig },
		driverConfig: { ...DEFAULT_CONFIG.driverConfig },
	};

	return config;
}

/**
 * Validate configuration values
 */
export function validateConfig(
	config: AppConfig,
	availableProviders?: string[],
): void {
	if (config.navigatorMaxTurns < 10 || config.navigatorMaxTurns > 100) {
		throw new Error("Navigator max turns must be between 10 and 100");
	}

	if (config.driverMaxTurns < 5 || config.driverMaxTurns > 50) {
		throw new Error("Driver max turns must be between 5 and 50");
	}

	if (config.maxPromptLength < 10 || config.maxPromptLength > 50000) {
		throw new Error(
			"Max prompt length must be between 10 and 50,000 characters",
		);
	}

	if (
		config.maxPromptFileSize < 1024 ||
		config.maxPromptFileSize > 1024 * 1024
	) {
		throw new Error("Max prompt file size must be between 1KB and 1MB");
	}

	if (
		config.sessionHardLimitMs < 60_000 ||
		config.sessionHardLimitMs > 8 * 60 * 60 * 1000
	) {
		throw new Error("Session hard limit must be between 1 minute and 8 hours");
	}

	// Validate provider types if available providers list is provided
	if (availableProviders) {
		const configs = [
			{ name: "navigator", config: config.navigatorConfig },
			{ name: "driver", config: config.driverConfig },
		];

		for (const { name, config: modelConfig } of configs) {
			if (!availableProviders.includes(modelConfig.provider)) {
				throw new Error(
					`Unknown ${name} provider type: "${modelConfig.provider}". Available providers: ${availableProviders.join(", ")}`,
				);
			}
			// Validate OpenCode requires model
			if (modelConfig.provider === "opencode" && !modelConfig.model) {
				throw new Error(
					`OpenCode provider requires a model. Please specify --${name}-model with format like 'openrouter/google/gemini-2.5-flash'`,
				);
			}
		}
	}
}
