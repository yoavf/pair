/**
 * Mock Tools - custom command parser
 *
 * Custom command parser for structured communication between agents.
 * Provides structured commands like {{Nod}}, {{Feedback}}, {{CodeReview}}, {{Complete}}.
 */

export interface NavigatorCommand {
	type: "code_review" | "complete";
	comment?: string;
	summary?: string;
	pass?: boolean; // For CodeReview: true = passing (ending), false = needs work (continue)
}

export interface DriverCommand {
	type: "request_review" | "request_guidance";
	context?: string;
}

/* biome-ignore lint/complexity/noStaticOnlyClass: Using a class as a simple namespace */
export class MockToolParser {
	/**
	 * Parse ALL navigator commands from text (for display purposes)
	 */
	static parseAllCommands(text: string): NavigatorCommand[] {
		const commands: NavigatorCommand[] = [];
		const trimmed = text.trim();

		// Check for Complete - allow multi-line content
		const completeMatch = trimmed.match(
			/{{\s*Complete(?:\s+summary="([\s\S]*?)")?\s*}}/i,
		);
		if (completeMatch) {
			commands.push({
				type: "complete",
				summary: completeMatch[1] || "",
			});
		}

		// Check for CodeReview (with optional pass parameter) - allow multi-line content
		const codeReviewMatch = trimmed.match(
			/{{\s*CodeReview(?:\s+comment="([\s\S]*?)")?(?:\s+pass="(true|false)")?\s*}}/i,
		);
		if (codeReviewMatch) {
			commands.push({
				type: "code_review",
				comment: codeReviewMatch[1] || "",
				pass: codeReviewMatch[2] === "true",
			});
		}

		// Nod/Feedback removed in simplified flow

		return commands;
	}

	/**
	 * Parse driver message for review requests
	 */
	static parseDriverMessage(text: string): DriverCommand | null {
		const requestReviewMatch = text.match(
			/{{\s*RequestReview(?:\s+context="([^"]*)")?\s*}}/i,
		);
		if (requestReviewMatch) {
			return {
				type: "request_review",
				context: requestReviewMatch[1] || "",
			};
		}

		const requestGuidanceMatch = text.match(
			/{{\s*RequestGuidance(?:\s+context="([^"]*)")?\s*}}/i,
		);
		if (requestGuidanceMatch) {
			return {
				type: "request_guidance",
				context: requestGuidanceMatch[1] || "",
			};
		}
		return null;
	}

	/**
	 * Format command for display
	 */
	static formatForDisplay(command: NavigatorCommand): string {
		switch (command.type) {
			case "code_review":
				return `📋 Code Review: ${command.comment || "Reviewing implementation..."}`;
			case "complete":
				return `✅ Task completed: ${command.summary || "Implementation finished"}`;
		}
	}
}
