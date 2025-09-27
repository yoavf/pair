/**
 * Navigator utility functions and constants
 */

import type { NavigatorCommand, NavigatorCommandType } from "../../types.js";

// Navigator prompt templates
export const NAVIGATOR_INITIAL_PROMPT_TEMPLATE = `[CONTEXT REMINDER] You are the navigator in our pair coding session. You just finished planning our work.

This is YOUR plan for "{originalTask}":

{plan}
---
This is what I've done so far: {driverMessage}`;

export const NAVIGATOR_REVIEW_PROMPT_TEMPLATE = `{driverMessage}

Use git diff / read tools to double check my work.

CRITICAL: You MUST respond with EXACTLY ONE MCP tool call:
- mcp__navigator__navigatorCodeReview with comment="assessment" and pass=true/false

Only mcp__navigator__navigatorCodeReview. No text.`;

export const NAVIGATOR_CONTINUE_PROMPT_TEMPLATE = `{driverMessage}

I'm continuing with the implementation. Let me know if you have any concerns.`;

// Permission decision type using proper NavigatorCommandType subset
export type PermissionDecisionType =
	| Extract<NavigatorCommandType, "approve" | "deny">
	| "none";

/**
 * Navigator utility functions
 */
export class NavigatorUtils {
	/**
	 * Extract comment from failed review command
	 */
	static extractFailedReviewComment(command: NavigatorCommand): string | null {
		if (command.type === "code_review" && command.pass === false) {
			return (
				command.comment || "Please address the review comments and continue."
			);
		}
		return null;
	}

	/**
	 * Check if command indicates session should end
	 */
	static shouldEndSession(command: NavigatorCommand): boolean {
		return command.type === "code_review" && command.pass === true;
	}

	/**
	 * Check if tool name is a decision tool (approve/deny)
	 */
	static isDecisionTool(name: string): boolean {
		return (
			name === "mcp__navigator__navigatorApprove" ||
			name === "mcp__navigator__navigatorDeny"
		);
	}

	/**
	 * Normalize navigator tool names
	 */
	static normalizeNavigatorTool(toolName: string): string {
		// Handle variations in tool names
		if (toolName.includes("approve")) return "mcp__navigator__navigatorApprove";
		if (toolName.includes("deny")) return "mcp__navigator__navigatorDeny";
		if (toolName.includes("review"))
			return "mcp__navigator__navigatorCodeReview";
		return toolName;
	}
}
