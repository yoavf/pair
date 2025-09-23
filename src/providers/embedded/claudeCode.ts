/**
 * Claude Code provider implementation
 *
 * Uses the Claude Code SDK to create embedded agent sessions that connect
 * to MCP servers via HTTP/SSE
 */

import { query } from "@anthropic-ai/claude-code";
import { isAllToolsEnabled } from "../../types/core.js";
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
	// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK returns internal generator with any message type
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
						// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK internal McpServerConfig type differs from ours
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
			// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK canUseTool has different signature than our interface
			canUseTool: options.canUseTool as any,
		};

		// Create the query session
		this.iterator = query({
			// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK query expects different prompt type
			prompt: this.inputStream as any,
			options: queryOptions,
			// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK returns internal generator type
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
		try {
			for await (const message of this.iterator) {
				// Capture session ID
				if (message.session_id && !this.sessionId) {
					this.sessionId = message.session_id;
				}

				// Pass through messages with minimal transformation
				// The agent classes expect Claude Code message format
				yield message as AgentMessage;
			}
		} catch (error) {
			// Add context to session errors
			const contextualError = new Error(
				`Claude Code session failed (session_id: ${this.sessionId || "none"}): ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			contextualError.cause = error;
			throw contextualError;
		}
	}

	/**
	 * Interrupt the session
	 */
	async interrupt(): Promise<void> {
		// Use Claude SDK's interrupt if available
		// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK internal iterator may have interrupt method
		if ((this.iterator as any).interrupt) {
			// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK internal iterator may have interrupt method
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
	// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK returns internal generator with any message type
	private iterator: AsyncGenerator<any, void>;

	constructor(options: StreamingSessionOptions) {
		this.inputStream = new AsyncUserMessageStream();

		// Combine standard tools with MCP tools (extracted from Driver/Navigator logic)
		const baseTools = isAllToolsEnabled(options.allowedTools)
			? undefined
			: options.allowedTools;
		const toolsToPass: string[] | undefined = baseTools
			? [...baseTools, ...options.additionalMcpTools]
			: undefined;

		// Configure MCP servers (embedded vs HTTP/SSE)
		const mcpServers = options.mcpServerUrl
			? {
					[options.mcpRole]: {
						type: "sse",
						url: options.mcpServerUrl,
						// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK internal McpServerConfig type differs from ours
					} as any,
				}
			: { [options.mcpRole]: options.embeddedMcpServer };

		// Create the query session (extracted from Driver/Navigator)
		this.iterator = query({
			// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK query expects different prompt type
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
				// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK canUseTool has different signature than our interface
				canUseTool: options.canUseTool as any,
			},
			// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK returns internal generator type
		}) as AsyncGenerator<any, void>;
	}

	/**
	 * AsyncIterable implementation
	 */
	async *[Symbol.asyncIterator](): AsyncIterator<AgentMessage> {
		try {
			for await (const message of this.iterator) {
				// Capture session ID
				if (message.session_id && !this.sessionId) {
					this.sessionId = message.session_id;
				}

				// Pass through messages with minimal transformation
				yield message as AgentMessage;
			}
		} catch (error) {
			// Add context to streaming session errors
			const contextualError = new Error(
				`Claude Code streaming session failed (session_id: ${this.sessionId || "none"}): ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			contextualError.cause = error;
			throw contextualError;
		}
	}

	/**
	 * Interrupt the session
	 */
	async interrupt(): Promise<void> {
		// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK internal iterator may have interrupt method
		if ((this.iterator as any).interrupt) {
			// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK internal iterator may have interrupt method
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

	getPlanningConfig(task: string): {
		prompt: string;
		detectPlanCompletion: (message: any) => string | null;
	} {
		return {
			prompt: `Our task is to: ${task}\n\nPlease create a clear, step-by-step implementation plan tailored to this repository.\n- Focus on concrete steps, specific files, and commands.\n- Keep it concise and actionable.\n- Do not implement changes now.\n\nWhen your plan is ready, call the ExitPlanMode tool with { plan: <your full plan> } to finish planning.`,
			detectPlanCompletion: (message) => {
				// Detect ExitPlanMode tool usage
				if (
					message.message?.content &&
					Array.isArray(message.message.content)
				) {
					for (const item of message.message.content) {
						if (
							item.type === "tool_use" &&
							item.name === "ExitPlanMode" &&
							item.input?.plan
						) {
							return item.input.plan as string;
						}
					}
				}
				return null;
			},
		};
	}
}
