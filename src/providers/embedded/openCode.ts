import path from "node:path";

import type {
	Event,
	EventMessagePartRemoved,
	EventMessagePartUpdated,
	EventMessageUpdated,
	EventPermissionUpdated,
	Part,
	Path,
	Permission,
	Project,
	Session,
	SessionPromptResponse,
} from "@opencode-ai/sdk";
import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk";
import { z } from "zod";
import type {
	AgentInputStream,
	AgentMessage,
	AgentSession,
	DiagnosticLogger,
	ProviderConfig,
	SessionOptions,
	StreamingAgentSession,
	StreamingSessionOptions,
} from "../types.js";
import { BaseEmbeddedProvider } from "./base.js";
import {
	normalizeToolInput,
	resolvePermissionToolName,
	resolveToolName,
} from "./openCode/normalization.js";

const DEFAULT_BASE_URL =
	process.env.OPENCODE_BASE_URL || "http://127.0.0.1:4096";
const DEFAULT_SERVER_HOST = process.env.OPENCODE_HOSTNAME || "127.0.0.1";
const ENV_SERVER_PORT = Number.parseInt(process.env.OPENCODE_PORT || "", 10);
const DEFAULT_SERVER_PORT = Number.isNaN(ENV_SERVER_PORT) ? 0 : ENV_SERVER_PORT;
const ENV_SERVER_TIMEOUT = Number.parseInt(
	process.env.OPENCODE_SERVER_TIMEOUT || "5000",
	10,
);
const DEFAULT_SERVER_TIMEOUT = Number.isNaN(ENV_SERVER_TIMEOUT)
	? 5000
	: ENV_SERVER_TIMEOUT;
const DEFAULT_MODEL_PROVIDER_ID =
	process.env.OPENCODE_MODEL_PROVIDER || "openrouter";
const DEFAULT_MODEL_ID =
	process.env.OPENCODE_MODEL_ID || "google/gemini-2.5-pro";
const ENV_AGENT_ARCHITECT = process.env.OPENCODE_AGENT_ARCHITECT;
const ENV_AGENT_NAVIGATOR = process.env.OPENCODE_AGENT_NAVIGATOR;
const ENV_AGENT_DRIVER = process.env.OPENCODE_AGENT_DRIVER;

type OpenCodeClient = ReturnType<typeof createOpencodeClient>;

const McpServerSchema = z.union([
	z.string(),
	z.object({
		url: z.string(),
		enabled: z.boolean().optional(),
		headers: z.record(z.string(), z.string()).optional(),
	}),
]);

const OpenCodeOptionsSchema = z
	.object({
		baseUrl: z.string().optional(),
		directory: z.string().optional(),
		apiKey: z.string().optional(),
		model: z
			.object({
				providerId: z.string(),
				modelId: z.string(),
			})
			.optional(),
		agents: z
			.object({
				architect: z.string().optional(),
				navigator: z.string().optional(),
				driver: z.string().optional(),
			})
			.optional(),
		mcpServers: z.record(McpServerSchema).optional(),
		startServer: z.boolean().optional(),
		server: z
			.object({
				hostname: z.string().optional(),
				port: z.number().optional(),
				timeout: z.number().optional(),
				config: z.record(z.string(), z.unknown()).optional(),
			})
			.optional(),
	})
	.default({});

type OpenCodeOptions = z.infer<typeof OpenCodeOptionsSchema>;

type ToolPermissionResult =
	| {
			behavior: "allow";
			updatedInput: Record<string, unknown>;
			updatedPermissions?: Record<string, unknown>;
	  }
	| { behavior: "deny"; message: string };

type ToolGuard = (
	toolName: string,
	input: Record<string, unknown>,
) => Promise<ToolPermissionResult>;

interface ModelConfig {
	providerId: string;
	modelId: string;
}

interface AgentNames {
	architect?: string;
	navigator?: string;
	driver?: string;
}

interface RemoteMcpServerConfig {
	url: string;
	enabled?: boolean;
	headers?: Record<string, string>;
}

interface OpenCodeProviderConfig {
	baseUrl?: string;
	directory?: string;
	model: ModelConfig;
	agents: AgentNames;
	startServer: boolean;
	server?: ServerOptions;
	mcpServers?: Record<string, RemoteMcpServerConfig>;
}

interface SessionConfigBase {
	role: "architect" | "navigator" | "driver";
	systemPrompt: string;
	directory?: string;
	model: ModelConfig;
	agentName?: string;
	canUseTool?: ToolGuard;
	includePartialMessages: boolean;
	diagnosticLogger?: DiagnosticLogger;
}

type StreamingSessionConfig = SessionConfigBase;
type ArchitectSessionConfig = SessionConfigBase;

interface ServerOptions {
	hostname?: string;
	port?: number;
	timeout?: number;
	config?: Record<string, unknown>;
}

interface SessionClientResources {
	getClient(): Promise<OpenCodeClient>;
	cleanup(): Promise<void>;
}

class AsyncMessageQueue<T> implements AsyncIterable<T> {
	private readonly queue: T[] = [];
	private readonly resolvers: Array<(value: IteratorResult<T, void>) => void> =
		[];
	private done = false;
	private error: unknown = null;

	push(value: T): void {
		if (this.done) return;
		if (this.resolvers.length > 0) {
			const resolve = this.resolvers.shift();
			resolve?.({ value, done: false });
		} else {
			this.queue.push(value);
		}
	}

	finish(): void {
		if (this.done) return;
		this.done = true;
		while (this.resolvers.length > 0) {
			const resolve = this.resolvers.shift();
			resolve?.({ value: undefined, done: true });
		}
	}

	throw(error: unknown): void {
		if (this.done) return;
		this.error = error;
		this.done = true;
		while (this.resolvers.length > 0) {
			const resolve = this.resolvers.shift();
			if (resolve) {
				resolve({
					value: undefined,
					done: true,
				});
			}
		}
	}

	private async next(): Promise<IteratorResult<T, void>> {
		if (this.error) {
			throw this.error;
		}

		if (this.queue.length > 0) {
			const value = this.queue.shift()!;
			return { value, done: false };
		}

		if (this.done) {
			return { value: undefined, done: true };
		}

		return new Promise<IteratorResult<T, void>>((resolve) => {
			this.resolvers.push(resolve);
		});
	}

	[Symbol.asyncIterator](): AsyncIterator<T, void, unknown> {
		return {
			next: () => this.next(),
		};
	}
}

function unwrapData<T>(
	result: T | { data: T | undefined; error?: unknown },
): T {
	if (result && typeof result === "object" && "data" in result) {
		const { data, error } = result as { data: T | undefined; error?: unknown };
		if (!data) {
			const message =
				error && typeof error === "object" && "message" in error
					? String((error as { message?: unknown }).message)
					: "OpenCode request failed";
			throw new Error(message);
		}
		return data;
	}
	return result as T;
}

function buildPlanTitle(role: string): string {
	return `pair-${role}-${new Date().toISOString()}`;
}

type OpenCodeToolStateStatus = "pending" | "running" | "completed" | "error";

class OpenCodeSessionBase implements AsyncIterable<AgentMessage> {
	public sessionId: string | null = null;
	protected readonly queue = new AsyncMessageQueue<AgentMessage>();
	protected readonly reasoningParts = new Map<string, string>();
	protected readonly toolStates = new Map<string, OpenCodeToolStateStatus>();
	protected readonly partMetadata = new Map<
		string,
		{ messageId: string; text: string }
	>();
	protected readonly messageBuffers = new Map<string, string>();
	protected readonly messagePartIds = new Map<string, Set<string>>();
	protected readonly emittedMessages = new Set<string>();
	// Track Navigator approval tool emissions to prevent duplicates
	private readonly navigatorApprovalKeys = new Set<string>();
	// Track active permission requests to ensure one approval per request
	private currentPermissionRequestId: string | null = null;

	private readonly promptQueue: string[] = [];
	private processing = false;
	private closed = false;
	private eventAbort?: AbortController;
	private eventLoopPromise?: Promise<void>;
	private readonly directory?: string;
	private readonly guard?: ToolGuard;
	private readonly includePartialMessages: boolean;
	private readonly initialized: Promise<void>;
	private readonly clientFactory: () => Promise<OpenCodeClient>;
	protected client!: OpenCodeClient;
	private readonly diagnosticLogger?: DiagnosticLogger;
	private toolIdsLogged = false;
	private readonly disposeResources?: () => Promise<void> | void;

	constructor(
		clientFactory: () => Promise<OpenCodeClient>,
		private readonly config: SessionConfigBase,
		disposeResources?: () => Promise<void> | void,
	) {
		this.clientFactory = clientFactory;
		this.directory = config.directory;
		this.guard = config.canUseTool;
		this.includePartialMessages = config.includePartialMessages;
		this.diagnosticLogger = config.diagnosticLogger;
		this.initialized = this.initialize();
		this.disposeResources = disposeResources;
	}

	protected get role(): "architect" | "navigator" | "driver" {
		return this.config.role;
	}

	private isNavigatorDecisionTool(toolName: string): boolean {
		return (
			toolName.includes("navigatorApprove") ||
			toolName.includes("navigatorDeny") ||
			toolName.includes("navigatorCodeReview")
		);
	}

	protected logDiagnostic(
		event: string,
		data: Record<string, unknown> = {},
	): void {
		try {
			this.diagnosticLogger?.(event, {
				role: this.role,
				sessionId: this.sessionId ?? undefined,
				...data,
			});
		} catch {
			// Swallow logging failures to avoid breaking execution
		}
	}

	/**
	 * Extracts array from tool.ids result with proper type checking
	 */
	private extractIdsArray(idsResult: unknown): unknown[] | null {
		// Direct array
		if (Array.isArray(idsResult)) {
			return idsResult;
		}

		// Wrapped in data property
		if (idsResult && typeof idsResult === "object" && "data" in idsResult) {
			const data = (idsResult as { data: unknown }).data;
			if (Array.isArray(data)) {
				return data;
			}
		}

		return null;
	}

	private async logAvailableTools(): Promise<void> {
		if (this.toolIdsLogged) return;
		if (!this.client || typeof this.client.tool?.ids !== "function") {
			this.toolIdsLogged = true;
			return;
		}
		try {
			const idsResult = await this.client.tool.ids({});
			const ids = this.extractIdsArray(idsResult);
			if (ids) {
				this.logDiagnostic("OPENCODE_TOOL_IDS", {
					ids,
				});
			}
		} catch (error) {
			this.logDiagnostic("OPENCODE_TOOL_IDS_ERROR", {
				error: error instanceof Error ? error.message : String(error),
			});
		} finally {
			this.toolIdsLogged = true;
		}
	}

	protected async initialize(): Promise<void> {
		this.client = await this.clientFactory();
		this.logDiagnostic("OPENCODE_INIT_CLIENT", {
			directory: this.directory,
			agent: this.config.agentName,
		});
		const sessionResult = await this.client.session.create({
			body: { title: buildPlanTitle(this.role) },
			query: this.directory ? { directory: this.directory } : undefined,
		});
		const session = unwrapData<Session>(sessionResult);
		this.sessionId = session.id;
		this.logDiagnostic("OPENCODE_SESSION_CREATED", {
			sessionTitle: session.title,
		});
		await this.startEventStream();
		void this.logAvailableTools();
		if (this.directory) {
			try {
				const pathInfoResult = await this.client.path.get({
					query: { directory: this.directory },
				});
				const pathInfo = unwrapData<Path>(pathInfoResult);
				this.logDiagnostic("OPENCODE_PATH_STATUS", {
					state: pathInfo.state,
					worktree: pathInfo.worktree,
					directory: pathInfo.directory,
				});
			} catch (error) {
				this.logDiagnostic("OPENCODE_PATH_STATUS_ERROR", {
					error: error instanceof Error ? error.message : String(error),
				});
			}
			try {
				const projectInfoResult = await this.client.project.current({
					query: { directory: this.directory },
				});
				const projectInfo = unwrapData<Project>(projectInfoResult);
				this.logDiagnostic("OPENCODE_PROJECT_STATUS", {
					projectId: projectInfo.id,
					worktree: projectInfo.worktree,
				});
			} catch (error) {
				this.logDiagnostic("OPENCODE_PROJECT_STATUS_ERROR", {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}

	protected async startEventStream(): Promise<void> {
		this.eventAbort = new AbortController();
		this.logDiagnostic("OPENCODE_EVENT_STREAM_SUBSCRIBE", {});
		const events = await this.client.event.subscribe({
			signal: this.eventAbort.signal,
			query: this.directory ? { directory: this.directory } : undefined,
		});
		this.eventLoopPromise = this.processEvents(events.stream);
	}

	protected async processEvents(stream: AsyncGenerator<Event>): Promise<void> {
		try {
			for await (const event of stream) {
				if (this.closed) break;
				if (!this.sessionId) continue;
				this.logDiagnostic("OPENCODE_EVENT_RECEIVED", {
					eventType: event.type,
				});
				switch (event.type) {
					case "permission.updated": {
						await this.handlePermission(event as EventPermissionUpdated);
						break;
					}
					case "message.updated": {
						this.handleMessageUpdated(event as EventMessageUpdated);
						break;
					}
					case "message.part.updated": {
						this.handlePartUpdated(event as EventMessagePartUpdated);
						break;
					}
					case "message.part.removed": {
						this.handlePartRemoved(event as EventMessagePartRemoved);
						break;
					}
					default:
						break;
				}
			}
		} catch (error) {
			if (!this.closed) {
				this.queue.throw(error);
			}
		}
	}

	protected handleMessageUpdated(event: EventMessageUpdated): void {
		if (event.properties.info.sessionID !== this.sessionId) return;
		const info = event.properties.info;
		this.logDiagnostic("OPENCODE_MESSAGE_UPDATED", {
			messageId: info.id,
			role: info.role,
		});
		if (info.role === "assistant" && info.error) {
			const message =
				typeof info.error === "object" &&
				"data" in info.error &&
				info.error.data &&
				typeof info.error.data === "object" &&
				"message" in info.error.data
					? String((info.error.data as Record<string, unknown>).message)
					: "Assistant error";
			this.logDiagnostic("OPENCODE_ASSISTANT_ERROR", {
				errorMessage: message,
			});
			this.queue.push({
				type: "system",
				session_id: this.sessionId ?? undefined,
				subtype: "assistant_error",
				message: { content: message },
			});
		}

		if (
			!this.includePartialMessages &&
			info.role === "assistant" &&
			info.time?.completed !== undefined &&
			!this.emittedMessages.has(info.id)
		) {
			const buffer = this.messageBuffers.get(info.id);
			if (buffer?.trim()) {
				this.queue.push({
					type: "assistant",
					session_id: this.sessionId ?? undefined,
					message: {
						content: [{ type: "text", text: buffer }],
					},
				});
			}
			this.emittedMessages.add(info.id);
			const partIds = this.messagePartIds.get(info.id);
			if (partIds) {
				for (const partId of partIds) {
					this.partMetadata.delete(partId);
				}
			}
			this.messageBuffers.delete(info.id);
			this.messagePartIds.delete(info.id);
		}
	}

	protected handlePartRemoved(event: EventMessagePartRemoved): void {
		if (event.properties.sessionID !== this.sessionId) return;
		this.reasoningParts.delete(event.properties.partID);
		this.toolStates.delete(event.properties.partID);
		this.partMetadata.delete(event.properties.partID);
		for (const parts of this.messagePartIds.values()) {
			parts.delete(event.properties.partID);
		}
	}

	protected handlePartUpdated(event: EventMessagePartUpdated): void {
		const part = event.properties.part;
		if (part.sessionID !== this.sessionId) return;
		switch (part.type) {
			case "text":
				this.logDiagnostic("OPENCODE_PART_TEXT", {
					partId: part.id,
					messageId: part.messageID,
					length: part.text?.length ?? 0,
				});
				this.handleTextPart(part);
				break;
			case "reasoning":
				this.logDiagnostic("OPENCODE_PART_REASONING", {
					partId: part.id,
					length: part.text?.length ?? 0,
				});
				this.handleReasoningPart(part);
				break;
			case "tool":
				this.logDiagnostic("OPENCODE_PART_TOOL", {
					partId: part.id,
					tool: part.tool,
					status: part.state.status,
				});
				this.handleToolPart(part);
				break;
			default:
				break;
		}
	}

	protected handleTextPart(part: Extract<Part, { type: "text" }>): void {
		const previousEntry = this.partMetadata.get(part.id);
		const previousText = previousEntry?.text ?? "";
		if (part.text === previousText) return;
		const delta = part.text.slice(previousText.length);
		this.partMetadata.set(part.id, {
			messageId: part.messageID,
			text: part.text,
		});
		let messageParts = this.messagePartIds.get(part.messageID);
		if (!messageParts) {
			messageParts = new Set();
			this.messagePartIds.set(part.messageID, messageParts);
		}
		messageParts.add(part.id);
		if (delta) {
			const currentBuffer = this.messageBuffers.get(part.messageID) ?? "";
			this.messageBuffers.set(part.messageID, currentBuffer + delta);
		}
		if (!delta) return;

		if (this.includePartialMessages) {
			this.queue.push({
				type: "assistant",
				session_id: this.sessionId ?? undefined,
				message: {
					content: [
						{
							type: "text",
							text: delta,
						},
					],
				},
			});
		}
	}

	protected handleReasoningPart(
		part: Extract<Part, { type: "reasoning" }>,
	): void {
		if (!this.includePartialMessages) return;
		const previous = this.reasoningParts.get(part.id) ?? "";
		if (part.text === previous) return;
		const delta = part.text.slice(previous.length);
		this.reasoningParts.set(part.id, part.text);
		if (!delta) return;
		this.queue.push({
			type: "assistant",
			session_id: this.sessionId ?? undefined,
			message: {
				content: [
					{
						type: "text",
						text: delta,
					},
				],
			},
		});
	}

	protected handleToolPart(part: Extract<Part, { type: "tool" }>): void {
		const previous = this.toolStates.get(part.id);
		const state = part.state;
		const mappedName = resolveToolName(
			part.tool,
			(state as { input?: unknown }).input,
		);
		if (!mappedName) return;

		switch (state.status) {
			case "running": {
				if (previous === "running") return;
				this.toolStates.set(part.id, "running");

				// For Navigator role, enforce strict tool usage rules
				if (this.role === "navigator") {
					if (
						this.currentPermissionRequestId &&
						this.isNavigatorDecisionTool(mappedName)
					) {
						// Block invalid tools during permission requests
						if (
							mappedName.includes("navigatorComplete") ||
							mappedName.includes("navigatorCodeReview")
						) {
							this.logDiagnostic("OPENCODE_NAVIGATOR_INVALID_TOOL_BLOCKED", {
								tool: mappedName,
								permissionId: this.currentPermissionRequestId,
								reason:
									"Complete/CodeReview not allowed during permission requests",
							});
							return;
						}

						// Allow only ONE decision tool per permission request (regardless of content)
						const permissionKey = this.currentPermissionRequestId;
						if (this.navigatorApprovalKeys.has(permissionKey)) {
							this.logDiagnostic(
								"OPENCODE_NAVIGATOR_DUPLICATE_DECISION_BLOCKED",
								{
									tool: mappedName,
									permissionId: this.currentPermissionRequestId,
									reason: "Permission already has a decision",
								},
							);
							return;
						}

						// Mark this permission as having a decision
						this.navigatorApprovalKeys.add(permissionKey);

						if (this.navigatorApprovalKeys.size > 50) {
							const keysArray = Array.from(this.navigatorApprovalKeys);
							this.navigatorApprovalKeys.clear();
							for (const key of keysArray.slice(-25)) {
								this.navigatorApprovalKeys.add(key);
							}
						}
					}
				}

				this.queue.push({
					type: "assistant",
					session_id: this.sessionId ?? undefined,
					message: {
						content: [
							{
								type: "tool_use",
								name: mappedName,
								id: part.callID,
								input: normalizeToolInput(mappedName, state.input),
							},
						],
					},
				});
				break;
			}
			case "completed": {
				if (previous === "completed") return;
				this.toolStates.set(part.id, "completed");
				this.queue.push({
					type: "user",
					session_id: this.sessionId ?? undefined,
					message: {
						content: [
							{
								type: "tool_result",
								tool_use_id: part.callID,
								text: state.output ?? "",
								content: state.metadata,
							},
						],
					},
				});
				break;
			}
			case "error": {
				if (previous === "error") return;
				this.toolStates.set(part.id, "error");
				this.queue.push({
					type: "user",
					session_id: this.sessionId ?? undefined,
					message: {
						content: [
							{
								type: "tool_result",
								tool_use_id: part.callID,
								text: state.error ?? "Tool call failed",
								is_error: true,
							},
						],
					},
				});
				break;
			}
			default: {
				this.toolStates.set(part.id, state.status as OpenCodeToolStateStatus);
				break;
			}
		}
	}

	protected async handlePermission(
		event: EventPermissionUpdated,
	): Promise<void> {
		const info = event.properties;
		if (info.sessionID !== this.sessionId) return;

		if (this.role === "navigator") {
			this.currentPermissionRequestId = info.id;
		}

		this.logDiagnostic("OPENCODE_PERMISSION_REQUEST", {
			permissionId: info.id,
			toolType: info.type,
		});

		const toolName = resolvePermissionToolName(
			info.type,
			info.metadata as Record<string, unknown>,
		);
		if (!toolName) {
			await this.respondToPermission(info, "once");
			return;
		}

		if (!this.guard) {
			await this.respondToPermission(info, "once");
			return;
		}

		let decision: ToolPermissionResult;
		try {
			decision = await this.guard(toolName, info.metadata ?? {});
		} catch (error) {
			await this.respondToPermission(info, "reject");
			this.queue.push({
				type: "system",
				session_id: this.sessionId ?? undefined,
				subtype: "permission_error",
				message: {
					content: `Permission handling failed for ${toolName}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				},
			});
			return;
		}

		if (decision.behavior === "allow") {
			await this.respondToPermission(info, "once");
			// Clear permission request ID after responding
			if (this.role === "navigator") {
				this.currentPermissionRequestId = null;
			}
			return;
		}

		await this.respondToPermission(info, "reject");
		// Clear permission request ID after responding
		if (this.role === "navigator") {
			this.currentPermissionRequestId = null;
		}
		this.queue.push({
			type: "system",
			session_id: this.sessionId ?? undefined,
			subtype: "permission_denied",
			message: {
				content: decision.message,
			},
		});
	}

	private async respondToPermission(
		info: Permission,
		response: "once" | "always" | "reject",
	): Promise<void> {
		this.logDiagnostic("OPENCODE_PERMISSION_RESPONSE", {
			permissionId: info.id,
			response,
		});
		await this.client.postSessionIdPermissionsPermissionId({
			path: { id: info.sessionID, permissionID: info.id },
			body: { response },
			query: this.directory ? { directory: this.directory } : undefined,
		});
	}

	protected async enqueuePrompt(text: string): Promise<void> {
		await this.initialized;
		this.promptQueue.push(text);
		void this.processPromptQueue();
	}

	private async processPromptQueue(): Promise<void> {
		if (this.processing) return;
		this.processing = true;
		while (this.promptQueue.length > 0 && !this.closed) {
			await this.initialized;
			const prompt = this.promptQueue.shift();
			if (!prompt) break;
			try {
				await this.sendPrompt(prompt);
			} catch (error) {
				this.queue.throw(error);
				break;
			}
		}
		this.processing = false;
	}

	protected async sendPrompt(text: string): Promise<void> {
		if (!this.sessionId) {
			throw new Error("OpenCode session is not initialized");
		}
		await this.initialized;
		this.logDiagnostic("OPENCODE_PROMPT_SUBMIT", {
			length: text.length,
			preview: text.slice(0, 200),
			agent: this.config.agentName,
		});
		const promptBody: {
			agent?: string;
			model: { providerID: string; modelID: string };
			system?: string;
			parts: Array<{ type: "text"; text: string }>;
		} = {
			model: {
				providerID: this.config.model.providerId,
				modelID: this.config.model.modelId,
			},
			system: this.config.systemPrompt || undefined,
			parts: [
				{
					type: "text" as const,
					text,
				},
			],
		};
		if (this.config.agentName) {
			promptBody.agent = this.config.agentName;
		}

		const promptResult = await this.client.session.prompt({
			path: { id: this.sessionId },
			query: this.directory ? { directory: this.directory } : undefined,
			body: promptBody,
		});
		unwrapData<SessionPromptResponse>(promptResult);
	}

	async end(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		try {
			if (this.eventAbort) {
				this.eventAbort.abort();
			}
			await this.eventLoopPromise;
		} finally {
			this.queue.finish();
			this.logDiagnostic("OPENCODE_SESSION_ENDED", {});
			try {
				await this.disposeResources?.();
			} catch {
				// Ignore cleanup failures
			}
		}
	}

	async interrupt(): Promise<void> {
		await this.initialized;
		if (!this.sessionId) return;
		this.logDiagnostic("OPENCODE_SESSION_INTERRUPT", {});
		await this.client.session.abort({
			path: { id: this.sessionId },
			query: this.directory ? { directory: this.directory } : undefined,
		});
	}

	[Symbol.asyncIterator](): AsyncIterator<AgentMessage> {
		return this.queue[Symbol.asyncIterator]();
	}
}

class OpenCodeArchitectSession
	extends OpenCodeSessionBase
	implements AgentSession
{
	sendMessage(message: string): void {
		void this.enqueuePrompt(message);
	}

	async end(): Promise<void> {
		await super.end();
	}
}

class OpenCodeStreamingSession
	extends OpenCodeSessionBase
	implements StreamingAgentSession
{
	readonly inputStream: AgentInputStream;

	constructor(
		clientFactory: () => Promise<OpenCodeClient>,
		streamingConfig: StreamingSessionConfig,
		disposeResources?: () => Promise<void> | void,
	) {
		super(clientFactory, streamingConfig, disposeResources);
		this.inputStream = {
			pushText: (text: string) => {
				void this.enqueuePrompt(text);
			},
			end: () => {
				void this.end();
			},
		};
	}

	async interrupt(): Promise<void> {
		await super.interrupt();
	}

	async end(): Promise<void> {
		await super.end();
	}
}

export class OpenCodeProvider extends BaseEmbeddedProvider {
	readonly name = "opencode";

	private readonly providerConfig: OpenCodeProviderConfig;
	private readonly activeCleanups = new Set<() => Promise<void>>();
	private externalMcpWarningLogged = false;
	private lastResolvedDirectory?: string;
	private activeProjectPath?: string;

	constructor(config: ProviderConfig) {
		super(config);
		const parsed = OpenCodeOptionsSchema.parse(config.options ?? {});
		const normalizedMcpServers = parsed.mcpServers
			? Object.entries(parsed.mcpServers).reduce<
					Record<string, RemoteMcpServerConfig>
				>((result, [key, value]) => {
					if (!value) return result;
					if (typeof value === "string") {
						result[key] = { url: value, enabled: true };
						return result;
					}
					result[key] = {
						url: value.url,
						enabled: value.enabled ?? true,
						headers: value.headers,
					};
					return result;
				}, {})
			: undefined;
		const envStartServer = process.env.OPENCODE_START_SERVER;
		const startServer =
			parsed.startServer ??
			(envStartServer ? envStartServer !== "false" : true);
		const serverConfig: ServerOptions | undefined = parsed.server
			? {
					hostname: parsed.server.hostname ?? DEFAULT_SERVER_HOST,
					port: parsed.server.port ?? DEFAULT_SERVER_PORT,
					timeout: parsed.server.timeout ?? DEFAULT_SERVER_TIMEOUT,
					config: parsed.server.config,
				}
			: undefined;
		const baseUrl =
			parsed.baseUrl ??
			process.env.OPENCODE_BASE_URL ??
			(startServer ? undefined : DEFAULT_BASE_URL);
		const modelId = parsed.model?.modelId || config.model || DEFAULT_MODEL_ID;
		const providerId = parsed.model?.providerId || DEFAULT_MODEL_PROVIDER_ID;

		this.providerConfig = {
			baseUrl,
			directory: parsed.directory,
			model: {
				providerId,
				modelId,
			},
			agents: {
				// Use OpenCode's built-in "plan" agent for architect role
				architect: parsed.agents?.architect ?? ENV_AGENT_ARCHITECT ?? "plan",
				navigator: parsed.agents?.navigator ?? ENV_AGENT_NAVIGATOR,
				driver: parsed.agents?.driver ?? ENV_AGENT_DRIVER,
			},
			startServer,
			server: serverConfig ?? {
				hostname: DEFAULT_SERVER_HOST,
				port: DEFAULT_SERVER_PORT,
				timeout: DEFAULT_SERVER_TIMEOUT,
			},
			mcpServers: normalizedMcpServers,
		};
	}

	createSession(options: SessionOptions): AgentSession {
		const sessionDirectory =
			this.providerConfig.directory || options.projectPath || undefined;
		const resolvedDirectory = this.resolveDirectory(sessionDirectory);
		const resources = this.createClientResources({
			role: "architect",
			directory: resolvedDirectory,
			sessionMcpServerUrl: this.normalizeMcpUrl(options.mcpServerUrl),
		});
		const cleanup = this.registerCleanup(resources.cleanup);
		const config: ArchitectSessionConfig = {
			role: "architect",
			systemPrompt: options.systemPrompt,
			directory: resolvedDirectory,
			agentName: this.providerConfig.agents.architect,
			model: this.providerConfig.model,
			canUseTool: options.canUseTool as ToolGuard | undefined,
			includePartialMessages:
				options.includePartialMessages !== undefined
					? options.includePartialMessages
					: false,
			diagnosticLogger: options.diagnosticLogger,
		};
		this.activeProjectPath = resolvedDirectory;
		this.lastResolvedDirectory = resolvedDirectory;
		return new OpenCodeArchitectSession(resources.getClient, config, cleanup);
	}

	createStreamingSession(
		options: StreamingSessionOptions,
	): StreamingAgentSession {
		const sessionDirectory =
			this.providerConfig.directory || options.projectPath || undefined;
		const resolvedDirectory = this.resolveDirectory(sessionDirectory);
		const resources = this.createClientResources({
			role: options.mcpRole,
			directory: resolvedDirectory,
			sessionMcpServerUrl: this.normalizeMcpUrl(options.mcpServerUrl),
		});
		const cleanup = this.registerCleanup(resources.cleanup);
		const config: StreamingSessionConfig = {
			role: options.mcpRole,
			systemPrompt: options.systemPrompt,
			directory: resolvedDirectory,
			agentName:
				options.mcpRole === "driver"
					? this.providerConfig.agents.driver
					: this.providerConfig.agents.navigator,
			model: this.providerConfig.model,
			canUseTool: options.canUseTool as ToolGuard | undefined,
			includePartialMessages: false,
			diagnosticLogger: options.diagnosticLogger,
		};
		this.activeProjectPath = resolvedDirectory;
		this.lastResolvedDirectory = resolvedDirectory;
		return new OpenCodeStreamingSession(resources.getClient, config, cleanup);
	}

	private normalizeMcpUrl(url?: string): string | undefined {
		if (!url) return undefined;
		const trimmed = url.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}

	private resolveDirectory(directory?: string): string | undefined {
		if (!directory) return undefined;
		const trimmed = directory.trim();
		if (!trimmed) return undefined;
		if (path.isAbsolute(trimmed)) {
			return path.normalize(trimmed);
		}
		return path.normalize(path.resolve(trimmed));
	}

	private registerCleanup(cleanup: () => Promise<void>): () => Promise<void> {
		let called = false;
		const wrapped = async (): Promise<void> => {
			if (called) return;
			called = true;
			try {
				await cleanup();
			} finally {
				this.activeCleanups.delete(wrapped);
			}
		};
		this.activeCleanups.add(wrapped);
		return wrapped;
	}

	private createClientResources(params: {
		role: "architect" | "navigator" | "driver";
		directory?: string;
		sessionMcpServerUrl?: string;
	}): SessionClientResources {
		const { role, directory, sessionMcpServerUrl } = params;
		const resolvedDirectory = this.resolveDirectory(
			directory ?? this.providerConfig.directory ?? this.lastResolvedDirectory,
		);
		let clientPromise: Promise<OpenCodeClient> | null = null;
		let serverHandle: { url: string; close(): void } | null = null;
		let cleaned = false;

		const getClient = async (): Promise<OpenCodeClient> => {
			if (!clientPromise) {
				clientPromise = (async () => {
					let baseUrl = this.providerConfig.baseUrl;

					if (this.providerConfig.startServer) {
						const serverOptions: ServerOptions = {
							hostname:
								this.providerConfig.server?.hostname ?? DEFAULT_SERVER_HOST,
							port: this.providerConfig.server?.port ?? DEFAULT_SERVER_PORT,
							timeout:
								this.providerConfig.server?.timeout ?? DEFAULT_SERVER_TIMEOUT,
							config: this.buildServerConfigForRole({
								role,
								directory: resolvedDirectory,
								sessionMcpServerUrl,
							}),
						};
						try {
							serverHandle = await createOpencodeServer(serverOptions);
						} catch (error) {
							throw new Error(
								`Failed to start OpenCode server: ${error instanceof Error ? error.message : String(error)}`,
							);
						}
						baseUrl = serverHandle.url;
					} else if (!baseUrl) {
						throw new Error(
							"OpenCode provider requires a base URL or startServer configuration",
						);
					} else if (sessionMcpServerUrl && !this.externalMcpWarningLogged) {
						console.warn(
							"[Pair][OpenCode] Embedded MCP servers are configured automatically when startServer=true. Ensure your external OpenCode instance registers navigator and driver MCP endpoints.",
						);
						this.externalMcpWarningLogged = true;
					}

					return createOpencodeClient({
						baseUrl,
						responseStyle: "data",
					});
				})();

				clientPromise.catch(() => {
					clientPromise = null;
					if (serverHandle) {
						try {
							serverHandle.close();
						} catch {}
						serverHandle = null;
					}
				});
			}

			return clientPromise;
		};

		const cleanup = async (): Promise<void> => {
			if (cleaned) return;
			cleaned = true;
			clientPromise = null;
			if (serverHandle) {
				try {
					serverHandle.close();
				} catch {}
				serverHandle = null;
			}
		};

		return {
			getClient,
			cleanup,
		};
	}

	private buildServerConfigForRole(params: {
		role: "architect" | "navigator" | "driver";
		directory?: string;
		sessionMcpServerUrl?: string;
	}): Record<string, unknown> | undefined {
		const { role, directory, sessionMcpServerUrl } = params;
		const base = this.cloneServerBaseConfig();
		const mcpServers = this.providerConfig.mcpServers;
		const mergedMcp = (base.mcp as Record<string, unknown> | undefined) ?? {};

		if (mcpServers && Object.keys(mcpServers).length > 0) {
			for (const [name, server] of Object.entries(mcpServers)) {
				const remoteConfig: Record<string, unknown> = {
					type: "remote",
					url: server.url,
					enabled: server.enabled ?? true,
				};
				if (server.headers && Object.keys(server.headers).length > 0) {
					remoteConfig.headers = server.headers;
				}
				mergedMcp[name] = remoteConfig;
			}
		}

		if (sessionMcpServerUrl) {
			mergedMcp[`pair-${role}`] = {
				type: "remote",
				url: sessionMcpServerUrl,
				enabled: true,
			};
		}

		if (Object.keys(mergedMcp).length > 0) {
			base.mcp = mergedMcp;
			const permission =
				(base.permission as Record<string, unknown> | undefined) ?? {};
			if (permission.edit === undefined) {
				permission.edit = "ask";
			}
			if (permission.bash === undefined) {
				permission.bash = "ask";
			}
			if (Object.keys(permission).length > 0) {
				base.permission = permission;
			}
		}

		const resolvedDirectory = this.resolveDirectory(
			directory ?? this.providerConfig.directory ?? this.lastResolvedDirectory,
		);
		if (resolvedDirectory) {
			if (!base.directory) {
				base.directory = resolvedDirectory;
			}
			const pathConfig =
				(base.path as Record<string, unknown> | undefined) ?? {};
			if (!pathConfig.directory) {
				pathConfig.directory = resolvedDirectory;
			}
			if (!pathConfig.worktree) {
				pathConfig.worktree = resolvedDirectory;
			}
			if (Object.keys(pathConfig).length > 0) {
				base.path = pathConfig;
			}
		}

		return Object.keys(base).length > 0 ? base : undefined;
	}

	private cloneServerBaseConfig(): Record<string, unknown> {
		const config = this.providerConfig.server?.config;
		if (!config) return {};
		return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
	}

	getPlanningConfig(task: string): {
		prompt: string;
		detectPlanCompletion: (message: any) => string | null;
	} {
		return {
			prompt: `Our task is to: ${task}\n\nPlease create a clear, step-by-step implementation plan tailored to this repository.\n- Focus on concrete steps, specific files, and commands.\n- Keep it concise and actionable.\n- Do not implement changes now.\n\nEnd your response with "PLAN COMPLETE" when you finish the plan.`,
			detectPlanCompletion: (message) => {
				// Detect text-based completion
				if (
					message.message?.content &&
					Array.isArray(message.message.content)
				) {
					let fullText = "";
					for (const item of message.message.content) {
						if (item.type === "text") {
							fullText += item.text ?? "";
						}
					}
					if (fullText.includes("PLAN COMPLETE")) {
						return fullText.replace("PLAN COMPLETE", "").trim();
					}
				}
				return null;
			},
		};
	}

	async cleanup(): Promise<void> {
		await super.cleanup();
		const pending = Array.from(this.activeCleanups);
		this.activeCleanups.clear();
		for (const cleanup of pending) {
			try {
				await cleanup();
			} catch {}
		}
	}
}
