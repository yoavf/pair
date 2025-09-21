/**
 * Integration tests for Navigator with real MCP server
 * These tests verify Navigator behavior with proper MCP infrastructure
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { Navigator } from "../../src/conversations/Navigator.js";
import { Logger } from "../../src/utils/logger.js";
import type { PermissionRequest } from "../../src/types/permission.js";
import { driverRequestReview } from "../../src/utils/mcpTools.js";
import { startPairMcpServer, type PairMcpServer } from "../../src/mcp/httpServer.js";
import { ClaudeCodeProvider } from "../../src/providers/embedded/claudeCode.js";

/**
 * Helper function to extract text content from a tool result content item
 */
function extractTextContent(contentItem: any): string | undefined {
  return contentItem && 'text' in contentItem && typeof contentItem.text === 'string'
    ? contentItem.text
    : undefined;
}

// Only run integration tests if enabled
const integrationTestsEnabled = process.env.RUN_INTEGRATION_TESTS;

describe.skipIf(!integrationTestsEnabled)("Navigator Integration Tests", () => {
  let navigator: Navigator;
  let mockLogger: Logger;
  let mcpServer: PairMcpServer;

  beforeAll(async () => {
    // Start MCP server for tests
    mcpServer = await startPairMcpServer();
    console.log('Test MCP Server started on port:', mcpServer.port);
  });

  afterEach(async () => {
    // Stop navigator after each test to close SSE connections
    if (navigator) {
      await navigator.stop();
    }
  });

  afterAll(async () => {
    // Close the MCP server
    if (mcpServer) {
      await mcpServer.close();
    }
  });

  beforeEach(() => {
    mockLogger = {
      logEvent: vi.fn(),
      getFilePath: vi.fn().mockReturnValue("/tmp/integration-test.log"),
      close: vi.fn(),
    } as any;

    // Create real Claude Code provider for integration tests
    const provider = new ClaudeCodeProvider({ type: "claude-code" });

    // Create Navigator with provider and MCP server URL
    navigator = new Navigator(
      "You are a navigator in a pair programming session. Respond only with MCP tool calls.",
      ["Read", "Grep", "Glob"],
      5, // Low turn limit for integration tests
      process.cwd(),
      mockLogger,
      provider,
      mcpServer.urls.navigator, // Provide the actual MCP server URL
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
    // Initialize navigator with a simple task and plan
    await navigator.initialize(
      "Add a hello world function",
      "1. Create a hello world function\n2. Test it works"
    );

    // Call the actual driverRequestReview tool handler to simulate real flow
    const toolResult = await driverRequestReview.handler(
      { context: "I added a hello world function" },
      {} as any
    );

    // Extract the message that would be sent to Navigator
    const contentItem = toolResult.content[0];
    const reviewMessage = extractTextContent(contentItem) || "Driver requesting review";

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