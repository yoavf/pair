/**
 * Core domain types for Claude Pair Programming
 */

export type Role = "navigator" | "driver" | "architect";

export type SessionPhase = "planning" | "execution" | "review" | "complete";

/**
 * Constant representing "allow all tools" in allowedTools arrays
 */
export const ALL_TOOLS_MARKER = "all" as const;

/**
 * Helper function to check if allowedTools array represents "all tools"
 */
export function isAllToolsEnabled(allowedTools: string[]): boolean {
	return allowedTools.length > 0 && allowedTools[0] === ALL_TOOLS_MARKER;
}

/**
 * File modification tools that require special handling
 */
export const FILE_MODIFICATION_TOOLS = ["Write", "Edit", "MultiEdit"] as const;

/**
 * Type guard to check if a tool is a file modification tool
 */
export function isFileModificationTool(
	toolName: string,
): toolName is (typeof FILE_MODIFICATION_TOOLS)[number] {
	return FILE_MODIFICATION_TOOLS.includes(toolName as any);
}

export interface Message {
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: Date;
	sessionRole: Role;
	// Optional symbol customization for system lines (e.g., ✓, x, •, ⏹)
	symbol?: string;
	symbolColor?: string; // ink color name
	// Optional: when a navigator emits a structured command
	commandType?: string;
	id?: string; // For driver/navigator messages
	replyToId?: string; // For navigator reactions targeting a driver message
	receivedAt?: Date; // For navigator messages: when forwarded to driver
}

export interface PairConfig {
	projectPath: string;
	initialTask: string;
}

export interface DisplayPane {
	role: Role;
	content: string[];
	isActive: boolean;
}

export interface PairProgrammingState {
	projectPath: string;
	initialTask: string;
	navigatorMessages: Message[];
	driverMessages: Message[];
	currentActivity: string;
	phase?: SessionPhase;
	quitState?: "normal" | "confirm";
}

export interface MessageEntry {
	key: string;
	message: Message;
	reactions: Message[];
}

export interface NodeError extends Error {
	code?: string;
}

export interface UserMessage {
	type: "user";
	message: {
		role: "user";
		content: Array<{ type: "text"; text: string }>;
	};
	parent_tool_use_id: null;
}
