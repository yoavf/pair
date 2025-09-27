/**
 * OpenCode provider type definitions and schemas
 */

import type { createOpencodeClient } from "@opencode-ai/sdk";
import { z } from "zod";
import type { PermissionGuardOptions } from "../../../types/permission.js";
import type { DiagnosticLogger } from "../../types.js";

export const McpServerSchema = z.union([
	z.string(),
	z.object({
		url: z.string(),
		enabled: z.boolean().optional(),
		headers: z.record(z.string(), z.string()).optional(),
	}),
]);

export const OpenCodeOptionsSchema = z
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

export type OpenCodeOptions = z.infer<typeof OpenCodeOptionsSchema>;

export type ToolPermissionResult =
	| {
			behavior: "allow";
			updatedInput: Record<string, unknown>;
			updatedPermissions?: Record<string, unknown>;
	  }
	| { behavior: "deny"; message: string };

export type ToolGuard = (
	toolName: string,
	input: Record<string, unknown>,
	options?: PermissionGuardOptions,
) => Promise<ToolPermissionResult>;

export interface ModelConfig {
	providerId: string;
	modelId: string;
}

export interface AgentNames {
	navigator?: string;
	driver?: string;
}

export interface RemoteMcpServerConfig {
	url: string;
	enabled?: boolean;
	headers?: Record<string, string>;
}

export interface OpenCodeProviderConfig {
	baseUrl?: string;
	directory?: string;
	model: ModelConfig;
	agents: AgentNames;
	startServer: boolean;
	server?: ServerOptions;
	mcpServers?: Record<string, RemoteMcpServerConfig>;
}

export interface SessionConfigBase {
	role: "navigator" | "driver" | "planning";
	systemPrompt: string;
	directory?: string;
	model: ModelConfig;
	agentName?: string;
	canUseTool?: ToolGuard;
	includePartialMessages: boolean;
	diagnosticLogger?: DiagnosticLogger;
}

export type StreamingSessionConfig = SessionConfigBase;
export type PlanningSessionConfig = SessionConfigBase;

export interface ServerOptions {
	hostname?: string;
	port?: number;
	timeout?: number;
	config?: Record<string, unknown>;
}

export interface SessionClientResources {
	getClient(): Promise<OpenCodeClient>;
	cleanup(): Promise<void>;
}

export type OpenCodeToolStateStatus =
	| "pending"
	| "running"
	| "completed"
	| "error";

// Re-export DiagnosticLogger for convenience
export type { DiagnosticLogger };

// Re-export OpenCode SDK types
export type {
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
export type OpenCodeClient = ReturnType<typeof createOpencodeClient>;
