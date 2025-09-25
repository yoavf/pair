import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenCodeProvider } from '../../../src/providers/embedded/opencode.js';
import type { StreamingSessionOptions, AgentMessage } from '../../../src/providers/types.js';

// Helper to create a controlled async event stream
class MockEventStream {
  private events: any[] = [];
  private resolvers: Array<{ resolve: (value: any) => void; reject: (reason?: any) => void }> = [];
  private closed = false;

  async *stream() {
    let index = 0;
    while (!this.closed) {
      if (index < this.events.length) {
        yield this.events[index++];
      } else {
        // Wait for new events
        await new Promise<void>((resolve, reject) => {
          this.resolvers.push({ resolve: () => resolve(), reject });
        });
      }
    }
  }

  pushEvent(event: any) {
    this.events.push(event);
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver.resolve(undefined);
    }
  }

  close() {
    this.closed = true;
    this.resolvers.forEach(r => r.resolve(undefined));
  }
}

// Mock the OpenCode SDK
const mockEventStream = new MockEventStream();
let sequenceCounter = 0;
const capturedGuardCalls: Array<{ toolName: string; sequence: number; callId?: string }> = [];
const emittedMessages: Array<{ type: string; content?: any; sequence: number }> = [];

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeServer: vi.fn(async () => ({
    url: 'http://127.0.0.1:9000',
    close: vi.fn(),
  })),
  createOpencodeClient: vi.fn(() => ({
    session: {
      create: vi.fn().mockResolvedValue({
        data: { id: 'test-session', title: 'test' },
      }),
      prompt: vi.fn().mockResolvedValue({ data: {} }),
      abort: vi.fn().mockResolvedValue({ data: {} }),
    },
    event: {
      subscribe: vi.fn().mockResolvedValue({ stream: mockEventStream.stream() }),
    },
    tool: {
      ids: vi.fn().mockResolvedValue({ data: [] }),
    },
    path: {
      get: vi.fn().mockResolvedValue({
        data: { state: 'ready', worktree: '', directory: '' },
      }),
    },
    project: {
      current: vi.fn().mockResolvedValue({
        data: { id: 'proj', worktree: '' },
      }),
    },
    postSessionIdPermissionsPermissionId: vi.fn().mockResolvedValue({ data: {} }),
  })),
}));

describe('OpenCode Permission/Tool Ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sequenceCounter = 0;
    capturedGuardCalls.length = 0;
    emittedMessages.length = 0;
    mockEventStream['events'] = [];
    mockEventStream['resolvers'] = [];
    mockEventStream['closed'] = false;
  });

  it('should emit tool_use before calling permission guard when permission arrives first', async () => {
    const provider = new OpenCodeProvider({
      model: 'openrouter/google/gemini-2.0-flash-exp',
      options: {
        startServer: true,
      },
    });

    const canUseTool = vi.fn(async (toolName: string, input: any, options?: any) => {
      capturedGuardCalls.push({
        toolName,
        sequence: ++sequenceCounter,
        callId: options?.toolId,
      });
      return { behavior: 'allow' as const, updatedInput: input };
    });

    const options: StreamingSessionOptions = {
      systemPrompt: 'test',
      allowedTools: ['all'],
      additionalMcpTools: [],
      maxTurns: 5,
      projectPath: '/test',
      mcpServerUrl: 'http://localhost:4097',
      mcpRole: 'driver',
      canUseTool,
      disallowedTools: [],
      includePartialMessages: false,
    };

    const session = provider.createStreamingSession(options);

    // Start collecting messages
    const messages: AgentMessage[] = [];
    const messagePromise = (async () => {
      for await (const message of session) {
        messages.push(message);
        emittedMessages.push({
          type: message.type,
          content: message.message?.content,
          sequence: ++sequenceCounter,
        });

        // Stop after we get the tool_use message
        if (message.type === 'assistant' && message.message?.content?.[0]?.type === 'tool_use') {
          break;
        }
      }
    })();

    // Wait for session initialization
    await new Promise(resolve => setTimeout(resolve, 50));

    const callId = 'call_123';
    const permissionId = 'perm_456';

    // Send permission event FIRST (this is the problematic ordering)
    mockEventStream.pushEvent({
      type: 'permission.updated',
      properties: {
        id: permissionId,
        sessionID: 'test-session',
        callID: callId,
        type: 'edit',
        metadata: {
          file_path: '/test/file.txt',
        },
      },
    });

    // Small delay to ensure permission would be processed first without our fix
    await new Promise(resolve => setTimeout(resolve, 20));

    // Then send the tool event
    mockEventStream.pushEvent({
      type: 'message.part.updated',
      properties: {
        sessionID: 'test-session',
        part: {
          id: 'part_789',
          messageID: 'msg_101',
          sessionID: 'test-session',
          type: 'tool',
          tool: 'edit',
          callID: callId,
          state: {
            status: 'running',
            input: {
              file_path: '/test/file.txt',
              old_string: 'old',
              new_string: 'new',
            },
          },
        },
      },
    });

    // Wait for messages to be processed
    await new Promise(resolve => setTimeout(resolve, 100));

    // Check the ordering
    const toolUseMessage = emittedMessages.find(m =>
      m.type === 'assistant' && m.content?.[0]?.type === 'tool_use'
    );
    const guardCall = capturedGuardCalls.find(c => c.callId === callId);

    expect(toolUseMessage, 'Tool use message should be emitted').toBeTruthy();
    expect(guardCall, 'Permission guard should be called').toBeTruthy();

    if (toolUseMessage && guardCall) {
      expect(toolUseMessage.sequence).toBeLessThan(
        guardCall.sequence,
        'Tool use should be emitted before permission guard is called'
      );
    }

    // Clean up
    mockEventStream.close();
    await session.end();
    await provider.cleanup();
  });

  it('should handle permission timeout when tool never arrives', async () => {
    const provider = new OpenCodeProvider({
      model: 'openrouter/google/gemini-2.0-flash-exp',
      options: {
        startServer: true,
      },
    });

    const canUseTool = vi.fn(async (toolName: string, input: any) => {
      capturedGuardCalls.push({
        toolName,
        sequence: ++sequenceCounter,
      });
      return { behavior: 'allow' as const, updatedInput: input };
    });

    const options: StreamingSessionOptions = {
      systemPrompt: 'test',
      allowedTools: ['all'],
      additionalMcpTools: [],
      maxTurns: 5,
      projectPath: '/test',
      mcpServerUrl: 'http://localhost:4097',
      mcpRole: 'driver',
      canUseTool,
      disallowedTools: [],
      includePartialMessages: false,
    };

    const session = provider.createStreamingSession(options);

    // Start collecting messages
    const messagePromise = (async () => {
      for await (const message of session) {
        emittedMessages.push({
          type: message.type,
          content: message.message?.content,
          sequence: ++sequenceCounter,
        });
      }
    })();

    // Wait for session initialization
    await new Promise(resolve => setTimeout(resolve, 50));

    const callId = 'call_orphan';

    // Send permission event but never send the tool event
    mockEventStream.pushEvent({
      type: 'permission.updated',
      properties: {
        id: 'perm_orphan',
        sessionID: 'test-session',
        callID: callId,
        type: 'edit',
        metadata: {
          file_path: '/test/orphan.txt',
        },
      },
    });

    // Wait for timeout (500ms + buffer)
    await new Promise(resolve => setTimeout(resolve, 600));

    // Permission guard should have been called after timeout
    expect(capturedGuardCalls.length).toBe(1);
    expect(capturedGuardCalls[0].toolName).toBe('Edit');

    // Clean up
    mockEventStream.close();
    await session.end();
    await provider.cleanup();
  });

  it('should handle tools that arrive before permissions correctly', async () => {
    const provider = new OpenCodeProvider({
      model: 'openrouter/google/gemini-2.0-flash-exp',
      options: {
        startServer: true,
      },
    });

    const canUseTool = vi.fn(async (toolName: string, input: any, options?: any) => {
      capturedGuardCalls.push({
        toolName,
        sequence: ++sequenceCounter,
        callId: options?.toolId,
      });
      return { behavior: 'allow' as const, updatedInput: input };
    });

    const options: StreamingSessionOptions = {
      systemPrompt: 'test',
      allowedTools: ['all'],
      additionalMcpTools: [],
      maxTurns: 5,
      projectPath: '/test',
      mcpServerUrl: 'http://localhost:4097',
      mcpRole: 'driver',
      canUseTool,
      disallowedTools: [],
      includePartialMessages: false,
    };

    const session = provider.createStreamingSession(options);

    // Start collecting messages
    const messages: AgentMessage[] = [];
    const messagePromise = (async () => {
      for await (const message of session) {
        messages.push(message);
        emittedMessages.push({
          type: message.type,
          content: message.message?.content,
          sequence: ++sequenceCounter,
        });
      }
    })();

    // Wait for session initialization
    await new Promise(resolve => setTimeout(resolve, 50));

    const callId = 'call_normal';

    // Send tool event FIRST (correct ordering)
    mockEventStream.pushEvent({
      type: 'message.part.updated',
      properties: {
        sessionID: 'test-session',
        part: {
          id: 'part_normal',
          messageID: 'msg_normal',
          sessionID: 'test-session',
          type: 'tool',
          tool: 'edit',
          callID: callId,
          state: {
            status: 'running',
            input: {
              file_path: '/test/normal.txt',
              old_string: 'old',
              new_string: 'new',
            },
          },
        },
      },
    });

    // Small delay
    await new Promise(resolve => setTimeout(resolve, 20));

    // Then send permission event
    mockEventStream.pushEvent({
      type: 'permission.updated',
      properties: {
        id: 'perm_normal',
        sessionID: 'test-session',
        callID: callId,
        type: 'edit',
        metadata: {
          file_path: '/test/normal.txt',
        },
      },
    });

    // Wait for messages to be processed
    await new Promise(resolve => setTimeout(resolve, 100));

    // Both should be processed in correct order
    const toolUseMessage = emittedMessages.find(m =>
      m.type === 'assistant' && m.content?.[0]?.type === 'tool_use'
    );
    const guardCall = capturedGuardCalls.find(c => c.callId === callId);

    expect(toolUseMessage, 'Tool use message should be emitted').toBeTruthy();
    expect(guardCall, 'Permission guard should be called').toBeTruthy();

    // Even with correct ordering, tool should still come before guard
    if (toolUseMessage && guardCall) {
      expect(toolUseMessage.sequence).toBeLessThan(
        guardCall.sequence,
        'Tool use should be emitted before permission guard is called'
      );
    }

    // Clean up
    mockEventStream.close();
    await session.end();
    await provider.cleanup();
  });
});