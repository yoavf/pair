/**
 * Mock interface for Claude Code SDK to enable deterministic testing
 */

export interface MockQueryMessage {
	type: "assistant" | "user" | "system" | "result";
	session_id?: string;
	message?: {
		content: Array<{
			type: "text" | "tool_use" | "tool_result";
			text?: string;
			name?: string;
			input?: any;
			id?: string;
			tool_use_id?: string;
			is_error?: boolean;
		}>;
	};
	subtype?: string; // For system messages
}

export interface MockScenario {
	name: string;
	messages: MockQueryMessage[];
	delay?: number; // Optional delay between messages
}

export class MockClaudeCodeSdk {
	private scenarios: Map<string, MockScenario> = new Map();
	private currentScenario: string | null = null;
	private messageIndex = 0;

	/**
	 * Set up a test scenario with predefined responses
	 */
	setupScenario(scenario: MockScenario): void {
		this.scenarios.set(scenario.name, scenario);
	}

	/**
	 * Activate a scenario for the next query call
	 */
	useScenario(name: string): void {
		if (!this.scenarios.has(name)) {
			throw new Error(`Unknown scenario: ${name}`);
		}
		this.currentScenario = name;
		this.messageIndex = 0;
	}

	/**
	 * Mock implementation of Claude Code SDK query function
	 */
	async* query(options: {
		prompt: any;
		options?: {
			cwd?: string;
			appendSystemPrompt?: string;
			allowedTools?: string[];
			mcpServers?: any;
			permissionMode?: string;
			maxTurns?: number;
			includePartialMessages?: boolean;
			canUseTool?: any;
		};
	}): AsyncGenerator<MockQueryMessage, void, unknown> {
		if (!this.currentScenario) {
			throw new Error("No scenario set. Call useScenario() first.");
		}

		const scenario = this.scenarios.get(this.currentScenario)!;

		for (const message of scenario.messages) {
			if (scenario.delay) {
				await new Promise(resolve => setTimeout(resolve, scenario.delay));
			}
			yield message;
		}
	}

	/**
	 * Reset the mock to initial state
	 */
	reset(): void {
		this.currentScenario = null;
		this.messageIndex = 0;
		this.scenarios.clear();
	}

	/**
	 * Get list of available scenarios
	 */
	getScenarios(): string[] {
		return Array.from(this.scenarios.keys());
	}
}

/**
 * Helper functions to create common mock messages
 */
export const MockMessageHelpers = {
	assistantToolUse(toolName: string, input: any, toolId = "tool-123"): MockQueryMessage {
		return {
			type: "assistant",
			session_id: "mock-session-123",
			message: {
				content: [
					{
						type: "tool_use",
						name: toolName,
						input,
						id: toolId,
					},
				],
			},
		};
	},

	toolResult(toolId: string, content: any, isError = false): MockQueryMessage {
		return {
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: toolId,
						is_error: isError,
						...content,
					},
				],
			},
		};
	},

	assistantText(text: string): MockQueryMessage {
		return {
			type: "assistant",
			session_id: "mock-session-123",
			message: {
				content: [
					{
						type: "text",
						text,
					},
				],
			},
		};
	},

	result(): MockQueryMessage {
		return {
			type: "result",
		};
	},

	systemMessage(subtype: string): MockQueryMessage {
		return {
			type: "system",
			subtype,
		};
	},
};

/**
 * Pre-built scenarios for common test cases
 */
export const CommonScenarios = {
	navigatorApproval: (): MockScenario => ({
		name: "navigator-approval",
		messages: [
			MockMessageHelpers.assistantToolUse("mcp__navigator__navigatorApprove", {
				comment: "Looks good, proceed with the edit",
			}),
			MockMessageHelpers.toolResult("tool-123", { content: [] }),
			MockMessageHelpers.result(),
		],
	}),

	navigatorDenial: (): MockScenario => ({
		name: "navigator-denial",
		messages: [
			MockMessageHelpers.assistantToolUse("mcp__navigator__navigatorDeny", {
				comment: "Please add error handling before making this change",
			}),
			MockMessageHelpers.toolResult("tool-123", { content: [] }),
			MockMessageHelpers.result(),
		],
	}),

	navigatorCodeReviewPass: (): MockScenario => ({
		name: "navigator-review-pass",
		messages: [
			MockMessageHelpers.assistantToolUse("mcp__navigator__navigatorCodeReview", {
				comment: "Implementation looks complete and correct",
				pass: true,
			}),
			MockMessageHelpers.toolResult("tool-123", { content: [] }),
			MockMessageHelpers.result(),
		],
	}),

	navigatorCodeReviewFail: (): MockScenario => ({
		name: "navigator-review-fail",
		messages: [
			MockMessageHelpers.assistantToolUse("mcp__navigator__navigatorCodeReview", {
				comment: "Missing error handling and tests",
				pass: false,
			}),
			MockMessageHelpers.toolResult("tool-123", { content: [] }),
			MockMessageHelpers.result(),
		],
	}),

	navigatorComplete: (): MockScenario => ({
		name: "navigator-complete",
		messages: [
			MockMessageHelpers.assistantToolUse("mcp__navigator__navigatorCodeReview", {
				comment: "Task completed successfully - all features implemented and tested",
				pass: true,
			}),
			MockMessageHelpers.toolResult("tool-123", { content: [] }),
			MockMessageHelpers.result(),
		],
	}),

	driverRequestReview: (): MockScenario => ({
		name: "driver-request-review",
		messages: [
			MockMessageHelpers.assistantText("I have completed the authentication feature."),
			MockMessageHelpers.assistantToolUse("mcp__driver__driverRequestReview", {
				context: "Implemented user login and logout functionality",
			}),
			MockMessageHelpers.toolResult("tool-123", {
				content: [{ type: "text", text: "🔍 Requesting review: Implemented user login and logout functionality" }]
			}),
			MockMessageHelpers.result(),
		],
	}),
};