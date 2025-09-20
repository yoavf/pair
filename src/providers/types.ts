/**
 * Provider abstraction layer for coding agents
 *
 * This module defines interfaces for different coding agent implementations
 * (Claude Code, Codex, OpenCode, etc.) while preserving MCP as the universal
 * communication protocol between agents.
 */

import type { EventEmitter } from "node:events";
import type { Role } from "../types.js";
import type { Logger } from "../utils/logger.js";

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
 * Options for creating an agent session
 */
export interface SessionOptions {
	systemPrompt: string;
	allowedTools: string[] | undefined; // undefined means all tools
	maxTurns: number;
	projectPath: string;
	mcpServerUrl: string;
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
 * Embedded provider interface for in-process agents (like Claude Code)
 */
export interface EmbeddedAgentProvider extends AgentProvider {
	readonly type: "embedded";

	/**
	 * Create a new session with the agent
	 */
	createSession(options: SessionOptions): AgentSession;
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
