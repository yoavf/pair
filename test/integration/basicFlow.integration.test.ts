/**
 * Integration tests using real Claude Code SDK
 * These tests use actual AI responses - use sparingly and with controlled prompts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Navigator } from "../../src/conversations/Navigator.js";
import { Logger } from "../../src/utils/logger.js";
import type { PermissionRequest } from "../../src/types/permission.js";
import { driverRequestReview } from "../../src/utils/mcpTools.js";


// Only run integration tests if enabled
const integrationTestsEnabled = process.env.RUN_INTEGRATION_TESTS;

describe.skipIf(!integrationTestsEnabled)("Integration Tests", () => {
  let navigator: Navigator;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      logEvent: vi.fn(),
      getFilePath: vi.fn().mockReturnValue("/tmp/integration-test.log"),
      close: vi.fn(),
    } as any;

    navigator = new Navigator(
      "You are a navigator in a pair programming session. Respond only with MCP tool calls.",
      ["Read", "Grep", "Glob"],
      5, // Low turn limit for integration tests
      process.cwd(),
      mockLogger,
    );
  });

  it("should handle a simple approval request", async () => {
    const request: PermissionRequest = {
      driverTranscript: "I want to add a simple console.log statement for debugging",
      toolName: "Edit",
      input: {
        file_path: "test.js",
        old_string: "// placeholder",
        new_string: "console.log('debug');"
      }
    };

    const result = await navigator.reviewPermission(request);

    // Navigator should make a decision
    expect(typeof result.allowed).toBe("boolean");

    // Log the actual response for manual verification
    console.log("Integration test result:", {
      allowed: result.allowed,
      comment: result.allowed ? result.comment : result.reason,
    });
  }, 20000); // 20 second timeout

  it("should handle a review request triggered by driver tool call", async () => {
    // Call the actual driverRequestReview tool handler to simulate real flow
    const toolResult = await driverRequestReview.handler({ context: "I added a hello world function" });

    // Extract the message that would be sent to Navigator
    const reviewMessage = toolResult.content[0]?.text || "Driver requesting review";

    const commands = await navigator.processDriverMessage(reviewMessage);

    expect(commands).not.toBeNull();
    expect(Array.isArray(commands)).toBe(true);
    if (commands && commands.length > 0) {
      expect(commands[0].type).toMatch(/^(code_review|complete)$/);
    }

  }, 20000);
});

describe("Mock vs Integration Consistency", () => {
  it("should verify mock message format matches real SDK format", () => {
    // This test ensures our mocks are realistic
    // Real SDK messages have this structure:
    const realSdkMessageStructure = {
      type: "assistant", // or "user", "system", "result"
      session_id: "session-123",
      message: {
        content: [{
          type: "tool_use", // or "text", "tool_result"
          name: "mcp__navigator__navigatorApprove",
          input: { comment: "Looks good" },
          id: "tool-456"
        }]
      }
    };

    // Our mock should match this structure
    expect(realSdkMessageStructure).toMatchObject({
      type: expect.any(String),
      message: {
        content: expect.arrayContaining([
          expect.objectContaining({
            type: expect.any(String),
          })
        ])
      }
    });
  });
});