/**
 * Unit tests for ClaudeCodeProvider
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClaudeCodeProvider } from '../../../src/providers/embedded/claudeCode.js';
import type { SessionOptions } from '../../../src/providers/types.js';

// Mock the Claude Code SDK
vi.mock("@anthropic-ai/claude-code", () => ({
  query: vi.fn().mockReturnValue({
    [Symbol.asyncIterator]: async function* () {
      // Mock messages from Claude
      yield {
        type: "assistant",
        session_id: "test-session-123",
        message: {
          content: [{
            type: "text",
            text: "Hello from mocked Claude"
          }]
        }
      };
      yield {
        type: "result",
        result: "completed"
      };
    }
  }),
}));

// Mock AsyncUserMessageStream
vi.mock('../../../src/utils/streamInput.js', () => ({
  AsyncUserMessageStream: vi.fn().mockImplementation(() => ({
    pushText: vi.fn(),
    end: vi.fn(),
    [Symbol.asyncIterator]: async function* () {
      yield "test message";
    }
  }))
}));

describe('ClaudeCodeProvider', () => {
  let provider: ClaudeCodeProvider;

  beforeEach(() => {
    provider = new ClaudeCodeProvider({ type: 'claude-code' });
  });

  it('should have correct name and type', () => {
    expect(provider.name).toBe('claude-code');
    expect(provider.type).toBe('embedded');
  });

  it('should create a session with proper options', () => {
    const options: SessionOptions = {
      systemPrompt: "Test prompt",
      allowedTools: ["Read", "Grep"],
      maxTurns: 5,
      projectPath: "/test/path",
      mcpServerUrl: "http://localhost:3000/mcp/navigator",
      permissionMode: "default",
    };

    const session = provider.createSession(options);

    expect(session).toBeDefined();
    expect(session.sessionId).toBe(null); // Initially null
    expect(typeof session.sendMessage).toBe('function');
    expect(typeof session.end).toBe('function');
  });

  it('should handle session message sending', () => {
    const session = provider.createSession({
      systemPrompt: "Test",
      allowedTools: undefined,
      maxTurns: 5,
      projectPath: "/test",
      mcpServerUrl: "http://localhost:3000/mcp/driver",
    });

    // Should not throw
    expect(() => session.sendMessage("Test message")).not.toThrow();

    // End session
    session.end();

    // Should throw after ending
    expect(() => session.sendMessage("Another message")).toThrow("Cannot send message to ended session");
  });

  it('should iterate over messages from session', async () => {
    const session = provider.createSession({
      systemPrompt: "Test",
      allowedTools: ["Read"],
      maxTurns: 5,
      projectPath: "/test",
      mcpServerUrl: "http://localhost:3000/mcp/navigator",
    });

    const messages = [];
    for await (const message of session) {
      messages.push(message);
      if (message.type === 'result') break;
    }

    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('assistant');
    expect(messages[1].type).toBe('result');

    // Session ID should be captured
    expect(session.sessionId).toBe('test-session-123');
  });

  it('should handle navigator vs driver MCP server URLs', () => {
    // Test navigator URL
    const navSession = provider.createSession({
      systemPrompt: "Navigator test",
      allowedTools: ["Read"],
      maxTurns: 5,
      projectPath: "/test",
      mcpServerUrl: "http://localhost:3000/mcp/navigator",
    });
    expect(navSession).toBeDefined();

    // Test driver URL
    const driverSession = provider.createSession({
      systemPrompt: "Driver test",
      allowedTools: ["all"],
      maxTurns: 10,
      projectPath: "/test",
      mcpServerUrl: "http://localhost:3000/mcp/driver",
    });
    expect(driverSession).toBeDefined();
  });
});