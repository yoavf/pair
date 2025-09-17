export type Role = "navigator" | "driver" | "architect";

export type NavigatorCommandType =
	| "code_review"
	| "complete"
	| "approve"
	| "approve_always"
	| "deny"
	| "feedback";

export interface Message {
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: Date;
	sessionRole: Role;
	// Optional symbol customization for system lines (e.g., ✓, x, •, ⏹)
	symbol?: string;
	symbolColor?: string; // ink color name
	// Optional: when a navigator emits a structured command
	commandType?: NavigatorCommandType;
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
	phase?: "planning" | "execution" | "review" | "complete";
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
