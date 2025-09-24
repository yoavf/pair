/**
 * Base class for embedded agent providers
 *
 * Embedded providers run in-process and connect to MCP servers via HTTP/SSE
 */

import type {
	AgentSession,
	EmbeddedAgentProvider,
	ProviderConfig,
	SessionOptions,
	StreamingAgentSession,
	StreamingSessionOptions,
} from "../types.js";

/**
 * Abstract base class for embedded agent providers
 */
export abstract class BaseEmbeddedProvider implements EmbeddedAgentProvider {
	readonly type = "embedded" as const;
	abstract readonly name: string;

	constructor(protected config: ProviderConfig) {}

	/**
	 * Create a new agent session
	 * Must be implemented by concrete providers
	 */
	abstract createSession(options: SessionOptions): AgentSession;

	/**
	 * Create a streaming session for Driver/Navigator agents
	 * Must be implemented by concrete providers
	 */
	abstract createStreamingSession(
		options: StreamingSessionOptions,
	): StreamingAgentSession;

	/**
	 * Optional initialization
	 */
	async initialize(): Promise<void> {
		// Override in subclasses if needed
	}

	/**
	 * Get provider-specific planning configuration
	 * Must be implemented by concrete providers
	 */
	abstract getPlanningConfig(task: string): {
		prompt: string;
		detectPlanCompletion: (message: any) => string | null;
	};

	/**
	 * Optional cleanup
	 */
	async cleanup(): Promise<void> {
		// Override in subclasses if needed
	}
}
