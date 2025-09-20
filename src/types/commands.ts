/**
 * Command types for communication between Navigator and Driver
 */

export type NavigatorCommandType =
	| "code_review"
	| "complete"
	| "approve"
	| "deny";

export interface NavigatorCommand {
	type: NavigatorCommandType;
	comment?: string;
	summary?: string;
	pass?: boolean; // For CodeReview: true = passing (ending), false = needs work (continue)
}

export type DriverCommandType = "request_review" | "request_guidance";

export interface DriverCommand {
	type: DriverCommandType;
	context?: string;
}
