/**
 * Base class for OpenCode sessions with event handling and message processing
 */

import type { AgentMessage } from "../../types.js";
import { AsyncMessageQueue } from "./asyncMessageQueue.js";
import {
	normalizeToolInput,
	resolvePermissionToolName,
	resolveToolName,
} from "./normalization.js";
import type {
	DiagnosticLogger,
	Event,
	EventMessagePartRemoved,
	EventMessagePartUpdated,
	EventMessageUpdated,
	EventPermissionUpdated,
	OpenCodeClient,
	OpenCodeToolStateStatus,
	Part,
	Path,
	Permission,
	Project,
	Session,
	SessionConfigBase,
	SessionPromptResponse,
	ToolGuard,
	ToolPermissionResult,
} from "./types.js";

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

export class OpencodeSessionBase implements AsyncIterable<AgentMessage> {
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

	// Track emitted tool callIDs and buffer permissions to ensure correct ordering
	private readonly emittedToolCallIds = new Set<string>();
	private readonly bufferedPermissions = new Map<string, Permission>();
	private readonly permissionTimeouts = new Map<string, NodeJS.Timeout>();

	// Debouncing for high-frequency events
	private eventDebounceTimer?: NodeJS.Timeout;
	private eventDebounceBuffer = new Map<string, number>();
	private textPartDebounceTimer?: NodeJS.Timeout;
	private textPartDebounceBuffer = new Map<
		string,
		{ messageId: string; length: number; count: number }
	>();
	private readonly EVENT_DEBOUNCE_MS = 1000;
	private readonly TEXT_PART_DEBOUNCE_MS = 500;
	private readonly BUFFER_EMISSION_DEBOUNCE_MS = 300;
	private bufferEmissionTimers = new Map<string, NodeJS.Timeout>();
	private lastEmittedBufferContent = new Map<string, string>();

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

	private summarizeMetadata(
		metadata?: Record<string, unknown> | null,
	): Record<string, unknown> | undefined {
		if (!metadata) return undefined;
		const summary: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(metadata)) {
			if (typeof value === "string") {
				const normalized = value.replace(/\s+/g, " ").trim();
				const max = 120;
				if (normalized.length > max) {
					summary[key] =
						`${normalized.slice(0, 80)}…${normalized.slice(-20)} (len ${normalized.length})`;
				} else {
					summary[key] = normalized;
				}
			} else if (Array.isArray(value)) {
				summary[key] = `Array(${value.length})`;
			} else {
				summary[key] = value as unknown;
			}
		}
		return summary;
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

				// Debounce event logging
				this.debounceEventLog(event.type);

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
			// Clean up debounce state
			const timer = this.bufferEmissionTimers.get(info.id);
			if (timer) {
				clearTimeout(timer);
				this.bufferEmissionTimers.delete(info.id);
			}
			this.lastEmittedBufferContent.delete(info.id);
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
				// Debounce text part logging
				this.debounceTextPartLog(
					part.id,
					part.messageID,
					part.text?.length ?? 0,
				);
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
			// Send accumulated buffer periodically to avoid fragmentation
			// This mimics Claude Code's batching behavior
			this.debounceBufferEmission(part.messageID);
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
						if (mappedName.includes("navigatorCodeReview")) {
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

				// Emit the tool_use message
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

				// Mark this tool as emitted
				this.emittedToolCallIds.add(part.callID);

				// Check if there's a buffered permission for this tool
				const bufferedPermission = this.bufferedPermissions.get(part.callID);
				if (bufferedPermission) {
					this.logDiagnostic("OPENCODE_PROCESSING_BUFFERED_PERMISSION", {
						callId: part.callID,
						toolName: mappedName,
					});

					// Clear the timeout since we're processing it now
					const timeout = this.permissionTimeouts.get(part.callID);
					if (timeout) {
						clearTimeout(timeout);
						this.permissionTimeouts.delete(part.callID);
					}

					// Remove from buffer and process
					this.bufferedPermissions.delete(part.callID);
					// Process the permission after a microtask to ensure tool_use is fully emitted
					setImmediate(() => {
						void this.processPermission(bufferedPermission);
					});
				}

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

		// Check if we're the driver role and if the tool has already been emitted
		if (this.role === "driver" && info.callID) {
			if (!this.emittedToolCallIds.has(info.callID)) {
				// Tool hasn't been emitted yet, buffer this permission
				this.logDiagnostic("OPENCODE_BUFFERING_PERMISSION", {
					permissionId: info.id,
					callId: info.callID,
					toolType: info.type,
				});

				this.bufferedPermissions.set(info.callID, info);

				// Set a timeout to process this permission even if the tool never arrives
				const timeout = setTimeout(() => {
					this.logDiagnostic("OPENCODE_PERMISSION_TIMEOUT", {
						callId: info.callID,
						permissionId: info.id,
					});
					const buffered = this.bufferedPermissions.get(info.callID!);
					if (buffered) {
						this.bufferedPermissions.delete(info.callID!);
						this.permissionTimeouts.delete(info.callID!);
						void this.processPermission(buffered);
					}
				}, 500);

				this.permissionTimeouts.set(info.callID, timeout);
				return;
			}
		}

		// Process the permission immediately
		await this.processPermission(info);
	}

	private async processPermission(info: Permission): Promise<void> {
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

		this.logDiagnostic("OPENCODE_PERMISSION_DETAILS", {
			toolName,
			callId: info.callID,
			metadata: this.summarizeMetadata(
				info.metadata as Record<string, unknown> | undefined,
			),
		});

		if (!this.guard) {
			await this.respondToPermission(info, "once");
			return;
		}

		let decision: ToolPermissionResult;
		try {
			decision = await this.guard(toolName, info.metadata ?? {}, {
				toolId: info.callID ?? undefined,
				metadata: info.metadata ?? undefined,
			});
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

			// Clear permission timeouts
			for (const timeout of this.permissionTimeouts.values()) {
				clearTimeout(timeout);
			}
			this.permissionTimeouts.clear();
			this.bufferedPermissions.clear();

			// Flush any remaining debounced logs
			if (this.eventDebounceTimer) {
				clearTimeout(this.eventDebounceTimer);
				this.flushEventDebounceBuffer();
			}
			if (this.textPartDebounceTimer) {
				clearTimeout(this.textPartDebounceTimer);
				this.flushTextPartDebounceBuffer();
			}

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

		// Clear any pending prompts to prevent them from being sent after interrupt
		this.promptQueue.length = 0;
		this.processing = false;

		this.logDiagnostic("OPENCODE_SESSION_INTERRUPT", {
			promptsCleared: true,
		});
		await this.client.session.abort({
			path: { id: this.sessionId },
			query: this.directory ? { directory: this.directory } : undefined,
		});
	}

	[Symbol.asyncIterator](): AsyncIterator<AgentMessage> {
		return this.queue[Symbol.asyncIterator]();
	}

	private debounceEventLog(eventType: string): void {
		const count = (this.eventDebounceBuffer.get(eventType) ?? 0) + 1;
		this.eventDebounceBuffer.set(eventType, count);

		if (this.eventDebounceTimer) {
			clearTimeout(this.eventDebounceTimer);
		}

		this.eventDebounceTimer = setTimeout(() => {
			this.flushEventDebounceBuffer();
		}, this.EVENT_DEBOUNCE_MS);
	}

	private flushEventDebounceBuffer(): void {
		if (this.eventDebounceBuffer.size > 0) {
			const summary: Record<string, number> = {};
			for (const [eventType, count] of this.eventDebounceBuffer) {
				summary[eventType] = count;
			}
			this.logDiagnostic("OPENCODE_EVENTS_RECEIVED", {
				events: summary,
				total: Array.from(this.eventDebounceBuffer.values()).reduce(
					(a, b) => a + b,
					0,
				),
			});
			this.eventDebounceBuffer.clear();
		}
		this.eventDebounceTimer = undefined;
	}

	private debounceTextPartLog(
		partId: string,
		messageId: string,
		length: number,
	): void {
		const existing = this.textPartDebounceBuffer.get(partId);
		if (existing) {
			existing.length = length;
			existing.count++;
		} else {
			this.textPartDebounceBuffer.set(partId, { messageId, length, count: 1 });
		}

		if (this.textPartDebounceTimer) {
			clearTimeout(this.textPartDebounceTimer);
		}

		this.textPartDebounceTimer = setTimeout(() => {
			this.flushTextPartDebounceBuffer();
		}, this.TEXT_PART_DEBOUNCE_MS);
	}

	private flushTextPartDebounceBuffer(): void {
		if (this.textPartDebounceBuffer.size > 0) {
			const parts: Array<{
				partId: string;
				messageId: string;
				length: number;
				updates: number;
			}> = [];
			for (const [partId, data] of this.textPartDebounceBuffer) {
				parts.push({
					partId,
					messageId: data.messageId,
					length: data.length,
					updates: data.count,
				});
			}
			this.logDiagnostic("OPENCODE_TEXT_PARTS_UPDATED", {
				parts,
				totalParts: parts.length,
				totalUpdates: parts.reduce((sum, p) => sum + p.updates, 0),
			});
			this.textPartDebounceBuffer.clear();
		}
		this.textPartDebounceTimer = undefined;
	}

	private debounceBufferEmission(messageId: string): void {
		// Clear existing timer for this message
		const existingTimer = this.bufferEmissionTimers.get(messageId);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		// Set new timer to emit accumulated buffer
		const timer = setTimeout(() => {
			this.emitAccumulatedBuffer(messageId);
			this.bufferEmissionTimers.delete(messageId);
		}, this.BUFFER_EMISSION_DEBOUNCE_MS);

		this.bufferEmissionTimers.set(messageId, timer);
	}

	private emitAccumulatedBuffer(messageId: string): void {
		const currentBuffer = this.messageBuffers.get(messageId) ?? "";
		const lastEmitted = this.lastEmittedBufferContent.get(messageId) ?? "";

		// Only emit if we have new content to avoid duplicates
		if (currentBuffer.length > lastEmitted.length && currentBuffer.trim()) {
			this.queue.push({
				type: "assistant",
				session_id: this.sessionId ?? undefined,
				message: {
					content: [
						{
							type: "text",
							text: currentBuffer,
						},
					],
				},
			});
			this.lastEmittedBufferContent.set(messageId, currentBuffer);
		}
	}
}
