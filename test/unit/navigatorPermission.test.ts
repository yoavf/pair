import { describe, it, expect, vi } from 'vitest';
import type {
  AgentInputStream,
  AgentMessage,
  AgentSession,
  EmbeddedAgentProvider,
  StreamingAgentSession,
  StreamingSessionOptions,
  SessionOptions,
} from '../../src/providers/types.js';
import { Navigator } from '../../src/conversations/Navigator.js';

class StubStreamingSession implements StreamingAgentSession {
  sessionId: string | null = null;
  inputStream: AgentInputStream = {
    pushText: vi.fn(),
    end: vi.fn(),
  };

  constructor(private readonly messages: AgentMessage[]) {}

  async interrupt(): Promise<void> {}

  async *[Symbol.asyncIterator](): AsyncIterator<AgentMessage> {
    for (const message of this.messages) {
      if (message.session_id && !this.sessionId) {
        this.sessionId = message.session_id;
      }
      yield message;
    }
  }
}

class StubProvider implements EmbeddedAgentProvider {
  readonly name = 'stub';
  readonly type = 'embedded' as const;

  constructor(private readonly messages: AgentMessage[]) {}

  createSession(_options: SessionOptions): AgentSession {
    throw new Error('not implemented');
  }

  createStreamingSession(_options: StreamingSessionOptions): StreamingAgentSession {
    return new StubStreamingSession(this.messages);
  }

  getPlanningConfig() {
    return {
      prompt: '',
      detectPlanCompletion: () => null,
    };
  }
}

describe('Navigator permission approvals', () => {
  it('resolves approval batches without result messages', async () => {
    const messages: AgentMessage[] = [
      {
        type: 'assistant',
        session_id: 'ses_test',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'mcp__navigator__navigatorApprove',
              id: 'tool_1',
              input: { comment: 'Looks good' },
            },
          ],
        },
      },
      {
        type: 'user',
        session_id: 'ses_test',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool_1',
              content: [],
            },
          ],
        },
      },
    ];

    const provider = new StubProvider(messages);
    const logger = { logEvent: vi.fn() } as any;
    const navigator = new Navigator(
      'system prompt',
      ['Read'],
      5,
      '/repo',
      logger,
      provider,
      'http://localhost/mcp/navigator',
    );

    const result = await navigator.reviewPermission({
      driverTranscript: 'Testing approve flow',
      toolName: 'Edit',
      input: { filePath: '/repo/file.txt' },
    });

    expect(result.allowed).toBe(true);
    expect(logger.logEvent).toHaveBeenCalledWith(
      'NAVIGATOR_BATCH_RESULT',
      expect.objectContaining({ commandCount: 1 }),
    );
  });

  it('treats approve tool as code review pass outside permission flow', async () => {
    const messages: AgentMessage[] = [
      {
        type: 'assistant',
        session_id: 'ses_test',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'mcp__navigator__navigatorApprove',
              id: 'tool_approval',
              input: { comment: 'Looks good overall.' },
            },
          ],
        },
      },
      {
        type: 'user',
        session_id: 'ses_test',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool_approval',
              content: [],
            },
          ],
        },
      },
    ];

    const provider = new StubProvider(messages);
    const logger = { logEvent: vi.fn() } as any;
    const navigator = new Navigator(
      'system prompt',
      ['Read'],
      5,
      '/repo',
      logger,
      provider,
      'http://localhost/mcp/navigator',
    );

    await navigator.initialize('Test task', 'Test plan');

    const commands = await navigator.processDriverMessage(
      'Please review the latest changes.',
    );

    expect(commands).not.toBeNull();
    expect(commands).toHaveLength(1);
    expect(commands![0]).toEqual({
      type: 'code_review',
      pass: true,
      comment: 'Looks good overall.',
    });
  });
});
