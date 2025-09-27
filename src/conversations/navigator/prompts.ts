/**
 * Navigator prompt templates and formatting utilities
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
		if (command.type === "code_review" && !command.pass && command.comment) {
			return command.comment.trim();
		}
		return null;
	}

	/**
	 * Check if command indicates session should end
	 */
	static shouldEndSession(command: NavigatorCommand): boolean {
		return command.type === "code_review" && command.pass === true;
	}
}

/**
 * Format prompt templates with variables
 */
export function formatPrompt(
	template: string,
	variables: Record<string, string>,
): string {
	let result = template;
	for (const [key, value] of Object.entries(variables)) {
		result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
	}
	return result;
}
