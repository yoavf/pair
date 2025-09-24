import path from "node:path";

import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk";
import type {
	AgentSession,
	ProviderConfig,
	SessionOptions,
	StreamingAgentSession,
	StreamingSessionOptions,
} from "../types.js";
import { BaseEmbeddedProvider } from "./base.js";
import {
	OpencodeArchitectSession,
	OpencodeStreamingSession,
} from "./opencode/sessions.js";
import type {
	AgentNames,
	ArchitectSessionConfig,
	ModelConfig,
	OpenCodeClient,
	OpenCodeOptions,
	OpenCodeProviderConfig,
	RemoteMcpServerConfig,
	ServerOptions,
	SessionClientResources,
	StreamingSessionConfig,
	ToolGuard,
} from "./opencode/types.js";
import { OpenCodeOptionsSchema } from "./opencode/types.js";

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

export class OpenCodeProvider extends BaseEmbeddedProvider {
	readonly name = "opencode";

	private readonly providerConfig: OpenCodeProviderConfig;
	private readonly activeCleanups = new Set<() => Promise<void>>();
	private externalMcpWarningLogged = false;
	private lastResolvedDirectory?: string;
	protected activeProjectPath?: string;

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

		// Parse model configuration from provider config
		// Format: "provider/model" where model part might contain additional slashes
		// OpenCode requires explicit model configuration
		let providerId: string;
		let modelId: string;

		if (config.model) {
			const firstSlash = config.model.indexOf("/");
			if (firstSlash !== -1) {
				// Split at first slash: provider/model
				providerId = config.model.substring(0, firstSlash);
				modelId = config.model.substring(firstSlash + 1);
			} else {
				// No slash means incomplete configuration for OpenCode
				throw new Error(
					`OpenCode requires full model specification. Got: '${config.model}'. Expected format: 'provider/model' (e.g., 'openrouter/google/gemini-2.0-flash')`,
				);
			}
		} else if (parsed.model?.providerId && parsed.model?.modelId) {
			// Fallback to parsed config from options if both are provided
			providerId = parsed.model.providerId;
			modelId = parsed.model.modelId;
		} else {
			throw new Error(
				"OpenCode provider requires model configuration. Please specify model with format 'provider/model' (e.g., '--architect opencode/openrouter/google/gemini-2.0-flash')",
			);
		}

		if (!providerId || !modelId) {
			throw new Error(
				"OpenCode provider requires model configuration. Please specify model with format 'provider/model'",
			);
		}

		this.providerConfig = {
			baseUrl,
			directory: parsed.directory,
			model: {
				providerId,
				modelId,
			},
			agents: {
				// Use OpenCode's built-in "plan" agent for architect role
				architect: parsed.agents?.architect ?? "plan",
				navigator: parsed.agents?.navigator ?? undefined,
				driver: parsed.agents?.driver ?? undefined,
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
		if (resolvedDirectory) {
			this.activeProjectPath = resolvedDirectory;
			this.lastResolvedDirectory = resolvedDirectory;
		}
		return new OpencodeArchitectSession(resources.getClient, config, cleanup);
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
		if (resolvedDirectory) {
			this.activeProjectPath = resolvedDirectory;
			this.lastResolvedDirectory = resolvedDirectory;
		}
		return new OpencodeStreamingSession(resources.getClient, config, cleanup);
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
