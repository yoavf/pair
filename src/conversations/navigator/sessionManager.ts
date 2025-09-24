/**
 * Navigator session management and message processing
 */

import { EventEmitter } from "node:events";
import type {
	AgentInputStream,
	EmbeddedAgentProvider,
	StreamingAgentSession,
} from "../../providers/types.js";
import type { NavigatorCommand, Role } from "../../types.js";
import type { Logger } from "../../utils/logger.js";
import {
	NAVIGATOR_TOOL_NAMES,
	navigatorMcpServer,
} from "../../utils/mcpServers.js";

export class NavigatorSessionManager extends EventEmitter {
	private sessionId: string | null = null;
	private inputStream?: AgentInputStream;
	private streamingSession: StreamingAgentSession | null = null;
	private processingLoopStarted = false;
	private batchResolvers: Array<(cmds: NavigatorCommand[]) => void> = [];
	private pendingCommands: NavigatorCommand[] = [];
	private pendingTools: Set<string> = new Set();
	private pendingToolWaiters: Array<() => void> = [];
	private toolResults: Map<string, any> = new Map();

	constructor(
		private systemPrompt: string,
		private allowedTools: string[],
		private maxTurns: number,
		private projectPath: string,
		private logger: Logger,
		private provider: EmbeddedAgentProvider,
		private mcpServerUrl?: string,
	) {
		super();
	}

	getSessionId(): string | null {
		return this.sessionId;
	}

	async ensureStreamingQuery() {
		if (this.streamingSession) return;

		this.logger.logEvent("NAVIGATOR_QUERY_INIT", {
			allowedTools: this.allowedTools,
			disallowedTools: ["Write", "Edit", "MultiEdit"],
			mcpServerUrl: this.mcpServerUrl,
			maxTurns: this.maxTurns,
			hasSystemPrompt: !!this.systemPrompt,
		});

		const embeddedMcpServer = this.mcpServerUrl
			? undefined
			: navigatorMcpServer;

		this.streamingSession = this.provider.createStreamingSession({
			systemPrompt: this.systemPrompt,
			allowedTools: this.allowedTools,
			additionalMcpTools: NAVIGATOR_TOOL_NAMES,
			maxTurns: this.maxTurns,
			projectPath: this.projectPath,
			mcpServerUrl: this.mcpServerUrl,
			embeddedMcpServer,
			mcpRole: "navigator",
			disallowedTools: ["Write", "Edit", "MultiEdit"],
			includePartialMessages: false,
			diagnosticLogger: (event, data) => {
				this.logger.logEvent(event, {
					agent: "navigator",
					provider: this.provider.name,
					...data,
				});
			},
		});

		this.inputStream = this.streamingSession.inputStream;

		if (!this.processingLoopStarted) {
			this.processingLoopStarted = true;
			void this.processMessages();
		}
	}

	sendText(text: string): void {
		this.inputStream?.pushText(text);
	}

	async waitForNoPendingTools(timeoutMs = 15000): Promise<void> {
		if (this.pendingTools.size === 0) return;

		return new Promise<void>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				reject(
					new Error(
						`Timeout waiting for pending tools: ${Array.from(this.pendingTools).join(", ")}`,
					),
				);
			}, timeoutMs);

			const checkPending = () => {
				if (this.pendingTools.size === 0) {
					clearTimeout(timeoutId);
					resolve();
				} else {
					this.pendingToolWaiters.push(checkPending);
				}
			};

			checkPending();
		});
	}

	waitForBatchCommands(): Promise<NavigatorCommand[]> {
		return new Promise<NavigatorCommand[]>((resolve) => {
			this.batchResolvers.push(resolve);
			this.deliverPendingCommandsIfReady();
		});
	}

	private async processMessages() {
		try {
			// biome-ignore lint/style/noNonNullAssertion: streamingSession guaranteed to exist after ensureStreamingQuery
			for await (const message of this.streamingSession!) {
				if (message.session_id) {
					if (!this.sessionId) {
						this.sessionId = message.session_id;
						this.logger.logEvent("NAVIGATOR_SESSION_CAPTURED", {
							sessionId: this.sessionId,
						});
					} else if (this.sessionId !== message.session_id) {
						this.logger.logEvent("NAVIGATOR_SESSION_MISMATCH", {
							previous: this.sessionId,
							received: message.session_id,
						});
						this.sessionId = message.session_id;
					}
				}
				if (message.type === "assistant" && message.message?.content) {
					const content = message.message.content;
					if (Array.isArray(content)) {
						let _fullText = "";
						for (const item of content) {
							if (item.type === "text") {
								// Do not emit free-form navigator text; tools only
								_fullText += `${item.text}\n`;
							} else if (item.type === "tool_use") {
								if (!item.name) {
									this.logger.logEvent("NAVIGATOR_TOOL_MISSING_NAME", {
										item: JSON.stringify(item),
									});
									console.warn("Navigator: tool_use item missing name:", item);
									continue;
								}
								const tname = item.name;
								const isDecision =
									NavigatorSessionManager.isDecisionTool(tname);
								const allowEmit = true;
								// Emit tool usage
								if (allowEmit) {
									this.emit("tool_use", {
										role: "navigator" as Role,
										tool: tname,
										input: item.input,
									});
								}
								// Add to pending tools
								if (item.id) {
									this.pendingTools.add(item.id);
									this.logger.logEvent("NAVIGATOR_TOOL_PENDING", {
										id: item.id,
										tool: tname,
									});
								}
							}
						}
					}
				} else if (message.type === "user" && message.message?.content) {
					const content = message.message.content;
					if (Array.isArray(content)) {
						for (const item of content) {
							if (item.type === "tool_result" && item.tool_use_id) {
								const id = item.tool_use_id;
								this.toolResults.set(id, item);
								if (this.pendingTools.has(id)) {
									this.pendingTools.delete(id);
									this.logger.logEvent("NAVIGATOR_TOOL_RESULT_OBSERVED", {
										id,
									});
									this.resolvePendingToolWaiters();
								}
								const mcpCmd = this.convertMcpToolToCommand(item);
								if (mcpCmd) {
									this.pendingCommands.push(mcpCmd);
									this.deliverPendingCommandsIfReady();
								}
							}
						}
					}
				} else if (message.type === "system") {
					// Handle system messages
					if (message.subtype === "turn_limit_reached") {
						this.logger.logEvent("NAVIGATOR_TURN_LIMIT_REACHED", {});
						break;
					}
				}
			}
		} catch (error) {
			this.logger.logEvent("NAVIGATOR_SESSION_ERROR", {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	private deliverPendingCommandsIfReady(force = false): void {
		if (this.pendingCommands.length === 0) return;
		if (!force && this.pendingTools.size > 0) return;

		const commands = [...this.pendingCommands];
		this.pendingCommands = [];

		this.logger.logEvent("NAVIGATOR_BATCH_RESULT", {
			commandCount: commands.length,
		});

		while (this.batchResolvers.length > 0) {
			const resolve = this.batchResolvers.shift();
			resolve?.(commands);
		}
	}

	private resolvePendingToolWaiters() {
		while (this.pendingToolWaiters.length > 0) {
			const waiter = this.pendingToolWaiters.shift();
			waiter?.();
		}
	}

	private convertMcpToolToCommand(toolResult: any): NavigatorCommand | null {
		const toolUseId = toolResult.tool_use_id;
		if (!toolUseId) return null;

		// Map tool names to command types
		const toolName = this.getToolNameById(toolUseId);
		if (!toolName) return null;

		if (toolName === "mcp__navigator__navigatorApprove") {
			const comment =
				toolResult.content?.comment || toolResult.text?.trim() || "";
			return {
				type: "approve",
				comment: comment || undefined,
			};
		}

		if (toolName === "mcp__navigator__navigatorDeny") {
			const comment =
				toolResult.content?.comment || toolResult.text?.trim() || "";
			return {
				type: "deny",
				comment: comment || undefined,
			};
		}

		if (toolName === "mcp__navigator__navigatorCodeReview") {
			const pass = toolResult.content?.pass ?? false;
			const comment =
				toolResult.content?.comment || toolResult.text?.trim() || "";
			return {
				type: "code_review",
				pass,
				comment: comment || undefined,
			};
		}

		if (toolName === "mcp__navigator__navigatorComplete") {
			const summary =
				toolResult.content?.summary || toolResult.text?.trim() || "";
			return {
				type: "complete",
				summary: summary || undefined,
			};
		}

		return null;
	}

	private getToolNameById(toolUseId: string): string | null {
		// Find the tool name by scanning tool results
		for (const [id, result] of this.toolResults.entries()) {
			if (id === toolUseId) {
				// Try to get tool name from the original tool_use if stored
				return result.toolName || null;
			}
		}
		return null;
	}

	static isDecisionTool(toolName: string): boolean {
		return (
			toolName === "mcp__navigator__navigatorApprove" ||
			toolName === "mcp__navigator__navigatorDeny"
		);
	}

	async stop(): Promise<void> {
		try {
			await this.streamingSession?.interrupt?.();
		} catch (error) {
			this.logger.logEvent("NAVIGATOR_STOP_ERROR", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
