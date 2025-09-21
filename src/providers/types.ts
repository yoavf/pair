/**
 * Provider abstraction layer for coding agents
 *
 * This module defines interfaces for different coding agent implementations
 * (Claude Code, Codex, OpenCode, etc.) while preserving MCP as the universal
 * communication protocol between agents.
 */

/**
 * Agent message types that providers must handle
 */
export interface AgentMessage {
	type: "assistant" | "user" | "system" | "result";
	session_id?: string;
	message?: {
		content:
			| Array<{
					type: "text" | "tool_use" | "tool_result";
					text?: string;
					name?: string;
					input?: Record<string, unknown>;
					id?: string;
					tool_use_id?: string;
					content?: unknown;
					is_error?: boolean;
			  }>
			| string;
	};
	subtype?: string; // For system messages like "turn_limit_reached"
}

/**
 * Provider configuration for each agent role
 */
export interface ProviderConfig {
	type: "claude-code" | "codex" | "opencode" | string;
	apiKey?: string;
	model?: string;
	baseUrl?: string;
	options?: Record<string, unknown>;
}

/**
 * Base interface for all agent providers
 */
export interface AgentProvider {
	/**
	 * Provider name (e.g., "claude-code", "codex", "opencode")
	 */
	readonly name: string;

	/**
	 * Provider type: embedded (in-process) or external (separate service)
	 */
	readonly type: "embedded" | "external";

	/**
	 * Initialize the provider
	 */
	initialize?(): Promise<void>;

	/**
	 * Clean up resources
	 */
	cleanup?(): Promise<void>;
}

/**
 * Input stream interface for sending messages to agents
 */
export interface AgentInputStream {
	pushText(text: string): void;
	end(): void;
}

/**
 * Session interface for embedded agent conversations
 */
export interface AgentSession extends AsyncIterable<AgentMessage> {
	/**
	 * Session identifier
	 */
	sessionId: string | null;

	/**
	 * Send a message to the agent
	 */
	sendMessage(message: string): void;

	/**
	 * Interrupt the session
	 */
	interrupt?(): Promise<void>;

	/**
	 * End the session
	 */
	end(): void;
}

/**
 * Streaming session interface for Driver/Navigator agents
 */
export interface StreamingAgentSession extends AsyncIterable<AgentMessage> {
	/**
	 * Session identifier (set after first message)
	 */
	sessionId: string | null;

	/**
	 * Input stream for sending messages
	 */
	inputStream: AgentInputStream;

	/**
	 * Interrupt the session
	 */
	interrupt?(): Promise<void>;
}

/**
 * Options for creating an agent session
 */
export interface SessionOptions {
	systemPrompt: string;
	allowedTools: string[] | undefined; // undefined means all tools
	maxTurns: number;
	projectPath: string;
	mcpServerUrl: string;
	role?: "navigator" | "driver"; // Explicit role instead of URL parsing (optional for Architect)
	canUseTool?: (
		toolName: string,
		input: Record<string, unknown>,
		options?: { signal?: AbortSignal; suggestions?: Record<string, unknown> },
	) => Promise<
		| {
				behavior: "allow";
				updatedInput: Record<string, unknown>;
				updatedPermissions?: Record<string, unknown>;
		  }
		| { behavior: "deny"; message: string }
	>;
	permissionMode?: "default" | "plan";
	includePartialMessages?: boolean;
	disallowedTools?: string[];
}

/**
 * Options for creating streaming sessions (Driver/Navigator)
 */
export interface StreamingSessionOptions {
	systemPrompt: string;
	allowedTools: string[];
	additionalMcpTools: string[]; // e.g., DRIVER_TOOL_NAMES, NAVIGATOR_TOOL_NAMES
	maxTurns: number;
	projectPath: string;
	mcpServerUrl?: string; // Optional - falls back to embedded server
	embeddedMcpServer?: any; // Embedded server object (driverMcpServer, navigatorMcpServer)
	mcpRole: "driver" | "navigator"; // Which MCP server to use
	canUseTool?: (
		toolName: string,
		input: Record<string, unknown>,
	) => Promise<
		| {
				behavior: "allow";
				updatedInput: Record<string, unknown>;
				updatedPermissions?: Record<string, unknown>;
		  }
		| { behavior: "deny"; message: string }
	>;
	disallowedTools?: string[];
	includePartialMessages?: boolean;
}

/**
 * Embedded provider interface for in-process agents (like Claude Code)
 */
export interface EmbeddedAgentProvider extends AgentProvider {
	readonly type: "embedded";

	/**
	 * Create a new session with the agent (for Architect)
	 */
	createSession(options: SessionOptions): AgentSession;

	/**
	 * Create a streaming session for Driver/Navigator agents
	 */
	createStreamingSession(
		options: StreamingSessionOptions,
	): StreamingAgentSession;
}

/**
 * External provider interface for out-of-process agents (future Codex, OpenCode, etc.)
 */
export interface ExternalAgentProvider extends AgentProvider {
	readonly type: "external";

	/**
	 * Get the connection details for the external agent
	 * The external agent will connect directly to the MCP server endpoints
	 */
	getConnectionInfo(): {
		serviceUrl: string;
		apiKey?: string;
		headers?: Record<string, string>;
	};

	/**
	 * Health check for the external service
	 */
	healthCheck(): Promise<boolean>;
}

/**
 * MCP Server configuration for Claude Code SDK
 */
export interface McpServerConfig {
	type: "sse" | "stdio";
	url?: string;
	command?: string;
	args?: string[];
}

/**
 * Type alias for canUseTool function from SessionOptions
 */
export type CanUseToolFunction = NonNullable<SessionOptions["canUseTool"]>;

/**
 * Type alias for canUseTool function from StreamingSessionOptions
 */
export type StreamingCanUseToolFunction = NonNullable<
	StreamingSessionOptions["canUseTool"]
>;

/**
 * Type guard to check if a provider is embedded
 */
export function isEmbeddedProvider(
	provider: AgentProvider,
): provider is EmbeddedAgentProvider {
	return provider.type === "embedded";
}

/**
 * Factory for creating agent providers
 */
export interface AgentProviderFactory {
	/**
	 * Create a provider based on configuration
	 */
	createProvider(config: ProviderConfig): AgentProvider;

	/**
	 * Register a new provider type
	 */
	registerProvider(
		type: string,
		providerClass: new (config: ProviderConfig) => AgentProvider,
	): void;

	/**
	 * Get list of available provider types
	 */
	getAvailableProviders(): string[];
}
