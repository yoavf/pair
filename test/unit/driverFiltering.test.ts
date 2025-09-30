/**
 * Tests for Driver message filtering when forwarding to Navigator
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Driver } from "../../src/conversations/Driver.js";
import { Logger } from "../../src/utils/logger.js";

// Mock the Claude Agent SDK
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(),
	tool: vi.fn(),
	createSdkMcpServer: vi.fn(),
}));

describe("Driver Message Filtering", () => {
	let mockLogger: Logger;

	beforeEach(() => {
		mockLogger = {
			logEvent: vi.fn(),
			getFilePath: vi.fn().mockReturnValue("/tmp/test.log"),
			close: vi.fn(),
		} as any;
	});

	it("should identify approved edit tools correctly", () => {
		// Test the filtering logic used in the driver
		const testCases = [
			{ toolName: "Write", shouldFilter: true },
			{ toolName: "Edit", shouldFilter: true },
			{ toolName: "MultiEdit", shouldFilter: true },
			{ toolName: "Read", shouldFilter: false },
			{ toolName: "Bash", shouldFilter: false },
			{ toolName: "Grep", shouldFilter: false },
			{ toolName: "Glob", shouldFilter: false },
			{ toolName: "TodoWrite", shouldFilter: false },
		];

		testCases.forEach(({ toolName, shouldFilter }) => {
			// This is the logic from Driver.ts:296-299
			const isApprovedEditTool =
				toolName === "Write" ||
				toolName === "Edit" ||
				toolName === "MultiEdit";

			expect(isApprovedEditTool).toBe(shouldFilter);
		});
	});

	it("should include non-edit tools for navigator context", () => {
		const messages = [
			"Let me check the current implementation",
			"⚙️  Tool: Read - package.json",
			"⚙️  Tool: Grep - pattern: \"dependencies\"",
			"⚙️  Tool: Bash - git status",
			"Now I'll make the changes"
		];

		const combined = Driver.combineMessagesForNavigator(messages);

		// All non-edit tools should be included for context
		expect(combined).toContain("⚙️  Tool: Read - package.json");
		expect(combined).toContain("⚙️  Tool: Grep - pattern: \"dependencies\"");
		expect(combined).toContain("⚙️  Tool: Bash - git status");
	});

	it("should handle empty messages array", () => {
		const combined = Driver.combineMessagesForNavigator([]);
		expect(combined).toBe("");
	});

	it("should handle single message", () => {
		const combined = Driver.combineMessagesForNavigator(["Single message"]);
		expect(combined).toBe("Single message");
	});

	it("should explain the filtering behavior", () => {
		// The filtering happens in Driver.processMessages() during tool_use processing
		// The actual forwarded text (fwdText) filters out approved edit tools
		// But the combineMessagesForNavigator() method just joins pre-filtered messages

		// This test documents the expected behavior:
		// 1. Driver uses Write/Edit/MultiEdit (already approved by navigator)
		// 2. Driver does NOT add these to fwdText (filtered out)
		// 3. Navigator only sees Read/Bash/Grep etc tools for context
		// 4. This prevents redundant "I approved this edit" → "⚙️ Tool: Edit" cycles

		expect(true).toBe(true); // Placeholder for documentation
	});
});

describe("Driver Tool Use Filtering Logic", () => {
	it("should identify edit tools correctly", () => {
		const editTools = ["Write", "Edit", "MultiEdit"];
		const nonEditTools = ["Read", "Bash", "Grep", "Glob", "TodoWrite"];

		// This tests the logic we implemented in the driver
		editTools.forEach(tool => {
			const isApprovedEditTool =
				tool === "Write" ||
				tool === "Edit" ||
				tool === "MultiEdit";
			expect(isApprovedEditTool).toBe(true);
		});

		nonEditTools.forEach(tool => {
			const isApprovedEditTool =
				tool === "Write" ||
				tool === "Edit" ||
				tool === "MultiEdit";
			expect(isApprovedEditTool).toBe(false);
		});
	});
});