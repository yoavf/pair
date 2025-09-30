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
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
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
		it("should not initiate code review without explicit request", async () => {
			// Setup scenario: Navigator just acknowledges continuation
			mockSdk.setupScenario({
				name: "navigator-acknowledge",
				messages: [
					MockMessageHelpers.assistantText("I understand you're continuing with implementation. I'll monitor your progress."),
					MockMessageHelpers.result(),
				],
			});
			mockSdk.useScenario("navigator-acknowledge");

			// Call processDriverMessage with isReviewRequested=false
			const commands = await navigator.processDriverMessage(
				"I'm continuing to implement the authentication module.",
				false  // No review requested
			);

			// Navigator should not return any review commands
			expect(commands).toBeNull();
		});

		it("should initiate code review when explicitly requested", async () => {
			// Setup scenario: Navigator performs code review
			mockSdk.setupScenario(CommonScenarios.navigatorCodeReviewPass());
			mockSdk.useScenario("navigator-review-pass");

			// Call processDriverMessage with isReviewRequested=true
			const commands = await navigator.processDriverMessage(
				"I have completed the authentication module. Please review my implementation.",
				true  // Review explicitly requested
			);

			expect(commands).toHaveLength(1);
			expect(commands![0].type).toBe("code_review");
			expect(commands![0].pass).toBe(true);
			expect(commands![0].comment).toBe("Implementation looks complete and correct");
		});

		it("should handle passing code review", async () => {
			// Setup scenario: Navigator approves the review
			mockSdk.setupScenario(CommonScenarios.navigatorCodeReviewPass());
			mockSdk.useScenario("navigator-review-pass");

			const commands = await navigator.processDriverMessage(
				"I have implemented user authentication with login/logout functionality. Please review.",
				true  // Review requested
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
				"I have implemented user authentication. Please review.",
				true  // Review requested
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
				"All features implemented and tested. Task should be complete.",
				true  // Review requested for completion
			);

			expect(commands).toHaveLength(1);
			expect(commands![0].type).toBe("code_review");
			expect(commands![0].pass).toBe(true);
			expect(commands![0].comment).toBe("Task completed successfully - all features implemented and tested");
		});
	});

	describe("Concurrent Permission Requests", () => {
		it("should handle multiple concurrent permission requests correctly", () => {
			// Add two active permission requests (simulating rapid successive edits)
			(navigator as any).activePermissionRequests.add("request-1");
			(navigator as any).activePermissionRequests.add("request-2");

			// Verify both requests are tracked
			expect((navigator as any).activePermissionRequests.size).toBe(2);
			expect((navigator as any).activePermissionRequests.has("request-1")).toBe(true);
			expect((navigator as any).activePermissionRequests.has("request-2")).toBe(true);

			// Mock permission coordinator to handle decisions
			(navigator as any).permissionCoordinator.handleNavigatorDecision = vi.fn().mockReturnValue(true);

			// Approve request-1 while request-2 is still pending
			const approval1Command = (navigator as any).convertMcpToolToCommand(
				"mcp__navigator__navigatorApprove",
				{ comment: "Approved file1", requestId: "request-1" }
			);

			// Should be null because it was handled
			expect(approval1Command).toBeNull();

			// Verify request-1 is removed but request-2 remains active
			expect((navigator as any).activePermissionRequests.size).toBe(1);
			expect((navigator as any).activePermissionRequests.has("request-1")).toBe(false);
			expect((navigator as any).activePermissionRequests.has("request-2")).toBe(true);

			// Now deny request-2
			const denial2Command = (navigator as any).convertMcpToolToCommand(
				"mcp__navigator__navigatorDeny",
				{ comment: "Denied file2", requestId: "request-2" }
			);

			// Should be null because it was handled
			expect(denial2Command).toBeNull();

			// Verify both requests are now cleared
			expect((navigator as any).activePermissionRequests.size).toBe(0);
		});

		it("should not block approval of second request when first is still pending", () => {
			// Add two active permission requests
			(navigator as any).activePermissionRequests.add("request-1");
			(navigator as any).activePermissionRequests.add("request-2");

			// Mock permission coordinator
			(navigator as any).permissionCoordinator.handleNavigatorDecision = vi.fn().mockReturnValue(true);

			// Try to approve request-2 while request-1 is still pending
			const command = (navigator as any).convertMcpToolToCommand(
				"mcp__navigator__navigatorApprove",
				{ comment: "Approved", requestId: "request-2" }
			);

			// Should process the approval (return null after handling)
			expect(command).toBeNull();

			// Verify the decision was handled
			expect((navigator as any).permissionCoordinator.handleNavigatorDecision).toHaveBeenCalledWith({
				type: "approve",
				comment: "Approved",
				requestId: "request-2",
			});

			// Request-2 should be removed, request-1 should remain
			expect((navigator as any).activePermissionRequests.has("request-1")).toBe(true);
			expect((navigator as any).activePermissionRequests.has("request-2")).toBe(false);
		});

		it("should ignore approval with wrong request ID", () => {
			// Add one active permission request
			(navigator as any).activePermissionRequests.add("request-1");

			// Try to approve with a different request ID
			const command = (navigator as any).convertMcpToolToCommand(
				"mcp__navigator__navigatorApprove",
				{ comment: "Approved", requestId: "wrong-request-id" }
			);

			// Should be ignored (logged as NAVIGATOR_APPROVE_OUTSIDE_PERMISSION_IGNORED)
			expect(command).toBeNull();
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
		// Add a permission request to simulate active permission flow
		const requestId = "test-request-id";
		(navigator as any).activePermissionRequests.add(requestId);
		// Mock permission coordinator to not handle this decision
		(navigator as any).permissionCoordinator.handleNavigatorDecision = vi.fn().mockReturnValue(false);

		const command = (navigator as any).convertMcpToolToCommand(
			"mcp__navigator__navigatorApprove",
			{ comment: "LGTM", requestId }
		);

		expect(command).toEqual({
			type: "code_review",
			comment: "LGTM",
			pass: true,
			requestId,
		});
	});

	it("should ignore approval outside permission flow", () => {
		// Clear any active permission requests
		(navigator as any).activePermissionRequests.clear();
		const command = (navigator as any).convertMcpToolToCommand(
			"mcp__navigator__navigatorApprove",
			{ comment: "LGTM" }
		);

		// Approve tools outside permission flow should be ignored - only CodeReview should control session completion
		expect(command).toBeNull();
	});

	it("should parse denial commands correctly during permission flow", () => {
		// Add a permission request to simulate active permission flow
		const requestId = "test-request-id";
		(navigator as any).activePermissionRequests.add(requestId);
		// Mock permission coordinator to not handle this decision
		(navigator as any).permissionCoordinator.handleNavigatorDecision = vi.fn().mockReturnValue(false);

		const command = (navigator as any).convertMcpToolToCommand(
			"mcp__navigator__navigatorDeny",
			{ comment: "Needs more testing", requestId }
		);

		expect(command).toEqual({
			type: "code_review",
			comment: "Needs more testing",
			pass: false,
			requestId,
		});
	});

	it("should ignore denial outside permission flow", () => {
		// Clear any active permission requests
		(navigator as any).activePermissionRequests.clear();
		const command = (navigator as any).convertMcpToolToCommand(
			"mcp__navigator__navigatorDeny",
			{ comment: "Needs more testing" }
		);

		// Deny tools outside permission flow should be ignored - only CodeReview should control session continuation
		expect(command).toBeNull();
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
			"mcp__navigator__navigatorCodeReview",
			{ comment: "All done!", pass: true }
		);

		expect(command).toEqual({
			type: "code_review",
			comment: "All done!",
			pass: true,
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
			type: "code_review",
			comment: "Task finished",
			pass: true,
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
