/**
 * Factory for creating and managing agent providers
 */

import { ClaudeCodeProvider } from "./embedded/claudeCode.js";
import type {
	AgentProvider,
	AgentProviderFactory,
	ProviderConfig,
} from "./types.js";

/**
 * Default factory implementation
 */
export class DefaultAgentProviderFactory implements AgentProviderFactory {
	private providers = new Map<
		string,
		new (
			config: ProviderConfig,
		) => AgentProvider
	>();

	constructor() {
		// Register default providers
		this.registerProvider("claude-code", ClaudeCodeProvider);
	}

	/**
	 * Create a provider instance based on configuration
	 */
	createProvider(config: ProviderConfig): AgentProvider {
		const ProviderClass = this.providers.get(config.type);

		if (!ProviderClass) {
			throw new Error(
				`Unknown provider type: ${config.type}. Available providers: ${this.getAvailableProviders().join(", ")}`,
			);
		}

		return new ProviderClass(config);
	}

	/**
	 * Register a new provider type
	 */
	registerProvider(
		type: string,
		providerClass: new (config: ProviderConfig) => AgentProvider,
	): void {
		this.providers.set(type, providerClass);
	}

	/**
	 * Get list of available provider types
	 */
	getAvailableProviders(): string[] {
		return Array.from(this.providers.keys());
	}
}

/**
 * Global factory instance
 */
export const agentProviderFactory = new DefaultAgentProviderFactory();
