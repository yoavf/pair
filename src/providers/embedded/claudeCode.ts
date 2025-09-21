/**
 * Claude Code provider implementation
 *
 * Uses the Claude Code SDK to create embedded agent sessions that connect
 * to MCP servers via HTTP/SSE
 */

import { query } from "@anthropic-ai/claude-code";
import { AsyncUserMessageStream } from "../../utils/streamInput.js";
import type {
	AgentInputStream,
	AgentMessage,
	AgentSession,
	SessionOptions,
	StreamingAgentSession,
	StreamingSessionOptions,
} from "../types.js";
import { BaseEmbeddedProvider } from "./base.js";

/**
 * Session implementation for Claude Code
 */
class ClaudeCodeSession implements AgentSession {
	sessionId: string | null = null;
	private iterator: AsyncGenerator<any, void>;
	private inputStream: AsyncUserMessageStream;
	private ended = false;

	constructor(options: SessionOptions) {
		this.inputStream = new AsyncUserMessageStream();

		// Configure MCP servers for communication (only for Navigator/Driver)
		const mcpServers = options.role
			? {
					[options.role]: {
						type: "sse",
						url: options.mcpServerUrl,
					} as any,
				}
			: {};

		// Convert options to Claude Code SDK format
		const queryOptions = {
			cwd: options.projectPath,
			appendSystemPrompt: options.systemPrompt,
			allowedTools: options.allowedTools,
			disallowedTools: options.disallowedTools,
			mcpServers,
			permissionMode: options.permissionMode || "default",
			maxTurns: options.maxTurns,
			includePartialMessages: options.includePartialMessages ?? true,
			canUseTool: options.canUseTool as any,
		};

		// Create the query session
		this.iterator = query({
			prompt: this.inputStream as any,
			options: queryOptions,
		}) as AsyncGenerator<any, void>;
	}

	/**
	 * Send a message to the agent
	 */
	sendMessage(message: string): void {
		if (this.ended) {
			throw new Error("Cannot send message to ended session");
		}
		this.inputStream.pushText(message);
	}

	/**
	 * AsyncIterable implementation
	 */
	async *[Symbol.asyncIterator](): AsyncIterator<AgentMessage> {
		for await (const message of this.iterator) {
			// Capture session ID
			if (message.session_id && !this.sessionId) {
				this.sessionId = message.session_id;
			}

			// Pass through messages with minimal transformation
			// The agent classes expect Claude Code message format
			yield message as AgentMessage;
		}
	}

	/**
	 * Interrupt the session
	 */
	async interrupt(): Promise<void> {
		// Use Claude SDK's interrupt if available
		if ((this.iterator as any).interrupt) {
			await (this.iterator as any).interrupt();
		}
	}

	/**
	 * End the session
	 */
	end(): void {
		this.ended = true;
		this.inputStream.end();
	}
}

/**
 * Streaming session implementation for Driver/Navigator
 */
class ClaudeCodeStreamingSession implements StreamingAgentSession {
	sessionId: string | null = null;
	inputStream: AgentInputStream;
	private iterator: AsyncGenerator<any, void>;

	constructor(options: StreamingSessionOptions) {
		this.inputStream = new AsyncUserMessageStream();

		// Combine standard tools with MCP tools (extracted from Driver/Navigator logic)
		const baseTools =
			options.allowedTools[0] === "all" ? undefined : options.allowedTools;
		const toolsToPass: string[] | undefined = baseTools
			? [...baseTools, ...options.additionalMcpTools]
			: undefined;

		// Configure MCP servers (embedded vs HTTP/SSE)
		const mcpServers = options.mcpServerUrl
			? { [options.mcpRole]: { type: "sse", url: options.mcpServerUrl } as any }
			: { [options.mcpRole]: options.embeddedMcpServer };

		// Create the query session (extracted from Driver/Navigator)
		this.iterator = query({
			prompt: this.inputStream as any,
			options: {
				cwd: options.projectPath,
				appendSystemPrompt: options.systemPrompt,
				allowedTools: toolsToPass,
				mcpServers,
				disallowedTools: options.disallowedTools,
				permissionMode: "default",
				maxTurns: options.maxTurns,
				includePartialMessages: options.includePartialMessages ?? true,
				canUseTool: options.canUseTool as any,
			},
		}) as AsyncGenerator<any, void>;
	}

	/**
	 * AsyncIterable implementation
	 */
	async *[Symbol.asyncIterator](): AsyncIterator<AgentMessage> {
		for await (const message of this.iterator) {
			// Capture session ID
			if (message.session_id && !this.sessionId) {
				this.sessionId = message.session_id;
			}

			// Pass through messages with minimal transformation
			yield message as AgentMessage;
		}
	}

	/**
	 * Interrupt the session
	 */
	async interrupt(): Promise<void> {
		if ((this.iterator as any).interrupt) {
			await (this.iterator as any).interrupt();
		}
	}
}

/**
 * Claude Code provider implementation
 */
export class ClaudeCodeProvider extends BaseEmbeddedProvider {
	readonly name = "claude-code";

	/**
	 * Create a new Claude Code session (for Architect)
	 */
	createSession(options: SessionOptions): AgentSession {
		return new ClaudeCodeSession(options);
	}

	/**
	 * Create a streaming session for Driver/Navigator
	 */
	createStreamingSession(
		options: StreamingSessionOptions,
	): StreamingAgentSession {
		return new ClaudeCodeStreamingSession(options);
	}
}
