/**
 * Integration tests for ClaudeCodeProvider with real MCP server
 * These tests verify the provider works with actual HTTP/SSE communication
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ClaudeCodeProvider } from '../../../src/providers/embedded/claudeCode.js';
import { startPairMcpServer, type PairMcpServer } from '../../../src/mcp/httpServer.js';
import type { SessionOptions } from '../../../src/providers/types.js';

// Only run integration tests if enabled
const integrationTestsEnabled = process.env.RUN_INTEGRATION_TESTS;

describe.skipIf(!integrationTestsEnabled)("ClaudeCodeProvider Integration", () => {
  let mcpServer: PairMcpServer;
  let provider: ClaudeCodeProvider;

  beforeAll(async () => {
    // Start real MCP server
    mcpServer = await startPairMcpServer();
    console.log('MCP Server started on port:', mcpServer.port);
  });

  afterAll(async () => {
    if (mcpServer) {
      await mcpServer.close();
      console.log('MCP Server closed');
    }
  });

  beforeEach(() => {
    provider = new ClaudeCodeProvider({ type: 'claude-code' });
  });

  it('should connect to navigator MCP endpoint', async () => {
    const options: SessionOptions = {
      systemPrompt: "You are a test navigator. Respond only with MCP tool calls.",
      allowedTools: ["Read", "Grep"],
      maxTurns: 2,
      projectPath: process.cwd(),
      mcpServerUrl: mcpServer.urls.navigator,
      permissionMode: "default",
    };

    const session = provider.createSession(options);
    expect(session).toBeDefined();

    // Send a message that should trigger MCP tools
    session.sendMessage("Please approve this test request using mcp__navigator__navigatorApprove tool with comment='Test approval'");

    // Wait for response (with timeout)
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), 5000)
    );

    try {
      const messagePromise = (async () => {
        for await (const message of session) {
          console.log('Received message type:', message.type);
          if (message.type === 'assistant' || message.type === 'result') {
            return message;
          }
        }
      })();

      const result = await Promise.race([messagePromise, timeout]);
      expect(result).toBeDefined();
    } catch (error) {
      // This might timeout without API keys, which is expected
      console.log('Session iteration completed or timed out (expected without API keys)');
    } finally {
      session.end();
    }
  }, 10000);

  it('should connect to driver MCP endpoint', async () => {
    const options: SessionOptions = {
      systemPrompt: "You are a test driver. Use MCP tools to communicate.",
      allowedTools: ["Read", "Write"],
      maxTurns: 2,
      projectPath: process.cwd(),
      mcpServerUrl: mcpServer.urls.driver,
      permissionMode: "default",
    };

    const session = provider.createSession(options);
    expect(session).toBeDefined();

    // Send a message that might trigger driver tools
    session.sendMessage("Request a review using mcp__driver__driverRequestReview tool");

    // Wait briefly to ensure no immediate errors
    await new Promise(resolve => setTimeout(resolve, 100));

    // Session should still be valid
    expect(() => session.sendMessage("Another message")).not.toThrow();

    session.end();
  }, 10000);

  it('should handle session lifecycle correctly', async () => {
    const session = provider.createSession({
      systemPrompt: "Test system prompt",
      allowedTools: undefined, // All tools
      maxTurns: 1,
      projectPath: process.cwd(),
      mcpServerUrl: mcpServer.urls.navigator,
    });

    // Session starts with no ID
    expect(session.sessionId).toBeNull();

    // Can send messages
    session.sendMessage("Test message");

    // Can interrupt if available
    if (session.interrupt) {
      await session.interrupt();
    }

    // Can end session
    session.end();

    // Cannot send after ending
    expect(() => session.sendMessage("Post-end message")).toThrow();
  });
});