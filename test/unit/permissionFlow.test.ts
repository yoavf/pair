/**
 * Tests for permission flow orchestration between Driver and Navigator
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockClaudeCodeSdk, CommonScenarios, MockMessageHelpers } from "../mocks/claudeCodeSdk.js";
import { Navigator } from "../../src/conversations/Navigator.js";
import type { NavigatorCommand } from "../../src/types.js";
import { Logger } from "../../src/utils/logger.js";
import type { PermissionRequest } from "../../src/types/permission.js";
import {
	PermissionDeniedError,
	PermissionMalformedError,
	NavigatorSessionError
} from "../../src/types/errors.js";
import type { EmbeddedAgentProvider } from "../../src/providers/types.js";

// Mock the Claude Code SDK module
vi.mock("@anthropic-ai/claude-code", () => ({
	query: vi.fn(),
	tool: vi.fn().mockImplementation((name: string, description: string, schema: any, handler: any) => ({
		name,
		description,
		schema,
		handler,
	})),
	createSdkMcpServer: vi.fn().mockImplementation((config: any) => ({
		instance: { connect: vi.fn() },
	})),
}));

describe("Permission Flow", () => {
	let mockSdk: MockClaudeCodeSdk;
	let navigator: Navigator;
	let mockLogger: Logger;
	let mockProvider: EmbeddedAgentProvider;

	beforeEach(async () => {
		mockSdk = new MockClaudeCodeSdk();
		mockLogger = {
			logEvent: vi.fn(),
			getFilePath: vi.fn().mockReturnValue("/tmp/test.log"),
			close: vi.fn(),
		} as any;

		// Create mock provider
		mockProvider = {
			name: "mock-provider",
			type: "embedded",
			createSession: vi.fn(),
			createStreamingSession: vi.fn().mockReturnValue({
				sessionId: null,
				inputStream: {
					pushText: vi.fn(),
					end: vi.fn(),
				},
				[Symbol.asyncIterator]: vi.fn(),
				interrupt: vi.fn(),
			}),
		} as any;

		// Create navigator with test configuration
		navigator = new Navigator(
			"Test navigator prompt",
			["Read", "Grep", "Glob"],
			10,
			"/test/project",
			mockLogger,
			mockProvider,
		);

		// Configure mock provider to use our mock SDK
		mockProvider.createStreamingSession = vi.fn().mockReturnValue({
			sessionId: null,
			inputStream: {
				pushText: vi.fn(),
				end: vi.fn(),
			},
			[Symbol.asyncIterator]: async function* () {
				for await (const message of mockSdk.query({ prompt: "test" })) {
					yield message;
				}
			},
			interrupt: vi.fn(),
		});
	});

	afterEach(() => {
		mockSdk.reset();
		vi.clearAllMocks();
	});

	describe("Permission Approval", () => {
		it("should approve edit when navigator says approve", async () => {
			// Setup scenario: Navigator approves the edit
			mockSdk.setupScenario(CommonScenarios.navigatorApproval());
			mockSdk.useScenario("navigator-approval");

			const request: PermissionRequest = {
				driverTranscript: "I want to edit the user authentication logic",
				toolName: "Edit",
				input: { file_path: "src/auth.ts", old_string: "old code", new_string: "new code" }
			};

			const result = await navigator.reviewPermission(request);

			expect(result.allowed).toBe(true);
			if (result.allowed) {
				expect(result.comment).toBe("Looks good, proceed with the edit");
				expect(result.updatedInput).toEqual({
					file_path: "src/auth.ts",
					old_string: "old code",
					new_string: "new code"
				});
			}
		});

		it("should deny edit when navigator says deny", async () => {
			// Setup scenario: Navigator denies the edit
			mockSdk.setupScenario(CommonScenarios.navigatorDenial());
			mockSdk.useScenario("navigator-denial");

			const request: PermissionRequest = {
				driverTranscript: "I want to edit the user authentication logic",
				toolName: "Write",
				input: { file_path: "src/auth.ts", content: "risky code" }
			};

			const result = await navigator.reviewPermission(request);

			expect(result.allowed).toBe(false);
			if (!result.allowed) {
				expect(result.reason).toBe("Please add error handling before making this change");
			}
		});
	});

	describe("Code Review", () => {
		it("should handle passing code review", async () => {
			// Setup scenario: Navigator approves the review
			mockSdk.setupScenario(CommonScenarios.navigatorCodeReviewPass());
			mockSdk.useScenario("navigator-review-pass");

			const commands = await navigator.processDriverMessage(
				"I have implemented user authentication with login/logout functionality. Please review."
			);

			expect(commands).toHaveLength(1);
			expect(commands![0].type).toBe("code_review");
			expect(commands![0].pass).toBe(true);
			expect(commands![0].comment).toBe("Implementation looks complete and correct");
		});

		it("should handle failing code review", async () => {
			// Setup scenario: Navigator fails the review
			mockSdk.setupScenario(CommonScenarios.navigatorCodeReviewFail());
			mockSdk.useScenario("navigator-review-fail");

			const commands = await navigator.processDriverMessage(
				"I have implemented user authentication. Please review."
			);

			expect(commands).toHaveLength(1);
			expect(commands![0].type).toBe("code_review");
			expect(commands![0].pass).toBe(false);
			expect(commands![0].comment).toBe("Missing error handling and tests");
		});

		it("should handle task completion", async () => {
			// Setup scenario: Navigator marks task as complete
			mockSdk.setupScenario(CommonScenarios.navigatorComplete());
			mockSdk.useScenario("navigator-complete");

			const commands = await navigator.processDriverMessage(
				"All features implemented and tested. Task should be complete."
			);

			expect(commands).toHaveLength(1);
			expect(commands![0].type).toBe("complete");
			expect(commands![0].summary).toBe("Task completed successfully - all features implemented and tested");
		});
	});

	describe("Session Management", () => {
		it("should track session ID from first response", async () => {
			mockSdk.setupScenario(CommonScenarios.navigatorApproval());
			mockSdk.useScenario("navigator-approval");

			expect(navigator.getSessionId()).toBeNull();

			await navigator.reviewPermission({
				driverTranscript: "Test message",
				toolName: "Edit",
				input: { file_path: "test.ts" }
			});

			expect(navigator.getSessionId()).toBe("mock-session-123");
		});
	});

	describe("Error Handling", () => {
		it("should throw PermissionMalformedError for invalid responses", async () => {
			// Setup scenario with malformed response - no MCP tools
			mockSdk.setupScenario({
				name: "malformed-response",
				messages: [
					MockMessageHelpers.assistantText("I approve this edit"), // Text instead of tool
					MockMessageHelpers.result(),
				],
			});
			mockSdk.useScenario("malformed-response");

			const request: PermissionRequest = {
				driverTranscript: "Test message",
				toolName: "Edit",
				input: { file_path: "test.ts" }
			};

			await expect(navigator.reviewPermission(request)).rejects.toThrow(PermissionMalformedError);
		});
	});
});

/**
 * Test utilities for command parsing
 */
describe("Navigator Command Parsing", () => {
	let navigator: Navigator;

	beforeEach(() => {
		const mockLogger = {
			logEvent: vi.fn(),
			getFilePath: vi.fn().mockReturnValue("/tmp/test.log"),
			close: vi.fn(),
		} as any;

		// Create mock provider for this test block
		const mockProvider: EmbeddedAgentProvider = {
			name: "mock-provider",
			type: "embedded",
			createSession: vi.fn(),
			createStreamingSession: vi.fn(),
		} as any;

		navigator = new Navigator(
			"Test navigator prompt",
			["Read"],
			10,
			"/test/project",
			mockLogger,
			mockProvider,
		);
	});

	it("should parse approval commands correctly during permission flow", () => {
		(navigator as any).inPermissionApproval = true;
		const command = (navigator as any).convertMcpToolToCommand(
			"mcp__navigator__navigatorApprove",
			{ comment: "LGTM" }
		);

		expect(command).toEqual({
			type: "approve",
			comment: "LGTM",
		});
	});

	it("should map approval to code review outside permission flow", () => {
		(navigator as any).inPermissionApproval = false;
		const command = (navigator as any).convertMcpToolToCommand(
			"mcp__navigator__navigatorApprove",
			{ comment: "LGTM" }
		);

		expect(command).toEqual({
			type: "code_review",
			pass: true,
			comment: "LGTM",
		});
	});

	it("should parse denial commands correctly during permission flow", () => {
		(navigator as any).inPermissionApproval = true;
		const command = (navigator as any).convertMcpToolToCommand(
			"mcp__navigator__navigatorDeny",
			{ comment: "Needs more testing" }
		);

		expect(command).toEqual({
			type: "deny",
			comment: "Needs more testing",
		});
	});

	it("should map denial to failed code review outside permission flow", () => {
		(navigator as any).inPermissionApproval = false;
		const command = (navigator as any).convertMcpToolToCommand(
			"mcp__navigator__navigatorDeny",
			{ comment: "Needs more testing" }
		);

		expect(command).toEqual({
			type: "code_review",
			pass: false,
			comment: "Needs more testing",
		});
	});

	it("should parse code review commands correctly", () => {
		const command = (navigator as any).convertMcpToolToCommand(
			"mcp__navigator__navigatorCodeReview",
			{ comment: "Good implementation", pass: true }
		);

		expect(command).toEqual({
			type: "code_review",
			comment: "Good implementation",
			pass: true,
		});
	});

	it("should parse completion commands correctly", () => {
		const command = (navigator as any).convertMcpToolToCommand(
			"mcp__navigator__navigatorComplete",
			{ summary: "All done!" }
		);

		expect(command).toEqual({
			type: "complete",
			summary: "All done!",
		});
	});

	it("should return null for unknown tool names", () => {
		const command = (navigator as any).convertMcpToolToCommand(
			"unknown__tool",
			{ data: "test" }
		);

		expect(command).toBeNull();
	});
});

/**
 * Test session ending logic
 */
describe("Session Management", () => {
	it("should identify session-ending commands", () => {
		const completeCommand: NavigatorCommand = {
			type: "complete",
			summary: "Task finished",
		};

		const passReviewCommand: NavigatorCommand = {
			type: "code_review",
			comment: "Looks good",
			pass: true,
		};

		const failReviewCommand: NavigatorCommand = {
			type: "code_review",
			comment: "Needs work",
			pass: false,
		};

		const approveCommand: NavigatorCommand = {
			type: "approve",
			comment: "OK",
		};

		expect(Navigator.shouldEndSession(completeCommand)).toBe(true);
		expect(Navigator.shouldEndSession(passReviewCommand)).toBe(true);
		expect(Navigator.shouldEndSession(failReviewCommand)).toBe(false);
		expect(Navigator.shouldEndSession(approveCommand)).toBe(false);
	});

	it("should extract failed review comments", () => {
		const failCommand: NavigatorCommand = {
			type: "code_review",
			comment: "Add error handling",
			pass: false,
		};

		const passCommand: NavigatorCommand = {
			type: "code_review",
			comment: "Looks good",
			pass: true,
		};

		expect(Navigator.extractFailedReviewComment(failCommand)).toBe("Add error handling");
		expect(Navigator.extractFailedReviewComment(passCommand)).toBeNull();
	});
});
