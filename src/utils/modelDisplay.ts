/**
 * Model display formatting utilities
 */

import type { ModelConfig } from "../providers/types.js";

/**
 * Format model name for display
 * Extracts meaningful model name from provider/model string
 */
export function formatModelName(modelConfig: ModelConfig): string {
	const { provider, model } = modelConfig;

	// If no model specified, show default
	if (!model) {
		return provider === "claude-code" ? "sonnet" : "default";
	}

	// For Claude Code, models are already short (opus-4.1, sonnet, etc.)
	if (provider === "claude-code") {
		return model;
	}

	// For OpenCode, show the full model path since it contains important routing info
	// e.g., "openrouter/google/gemini-2.5-flash" stays as-is
	return model;
}

/**
 * Get display info for a role configuration
 */
export function getRoleDisplayInfo(modelConfig: ModelConfig): {
	provider: string;
	model: string;
} {
	return {
		provider: modelConfig.provider,
		model: formatModelName(modelConfig),
	};
}
