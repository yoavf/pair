/**
 * Command types for communication between Navigator and Driver
 */

export type NavigatorCommandType = "code_review" | "approve" | "deny";

export interface NavigatorCommand {
	type: NavigatorCommandType;
	comment?: string;
	pass?: boolean; // For CodeReview: true = passing (ending), false = needs work (continue)
	requestId?: string; // For approve/deny: links response to specific permission request
}

export type DriverCommandType = "request_review" | "request_guidance";

export interface DriverCommand {
	type: DriverCommandType;
	context?: string;
}
