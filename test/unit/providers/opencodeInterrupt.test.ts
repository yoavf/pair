import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpencodeStreamingSession } from '../../../src/providers/embedded/opencode/sessions.js';
import type { OpenCodeClient, StreamingSessionConfig } from '../../../src/providers/embedded/opencode/types.js';

const promptsSubmitted: Array<{ text: string; timestamp: number }> = [];

// Mock OpenCode client that tracks prompt submissions
const createMockClient = (): OpenCodeClient => ({
  session: {
    create: vi.fn().mockResolvedValue({
      data: { id: 'test-session', title: 'test' },
    }),
    prompt: vi.fn().mockImplementation(async ({ body }) => {
      promptsSubmitted.push({
        text: body.parts[0].text,
        timestamp: Date.now(),
      });
      return { data: {} };
    }),
    abort: vi.fn().mockResolvedValue({ data: {} }),
  },
  event: {
    subscribe: vi.fn().mockResolvedValue({
      stream: (async function* () {
        // Empty event stream for testing
      })(),
    }),
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
} as any);

describe('OpenCode Interrupt Clears Prompt Queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    promptsSubmitted.length = 0;
  });

  it('should clear prompt queue on interrupt and not send queued prompts', async () => {
    const mockClient = createMockClient();
    const clientFactory = vi.fn().mockResolvedValue(mockClient);

    const config: StreamingSessionConfig = {
      role: 'driver',
      systemPrompt: 'test',
      directory: '/test',
      model: {
        providerId: 'openrouter',
        modelId: 'google/gemini-2.0-flash-exp',
      },
      includePartialMessages: false,
    };

    const session = new OpencodeStreamingSession(clientFactory, config);

    // Wait for session initialization
    await new Promise(resolve => setTimeout(resolve, 50));

    // Send the first prompt
    session.inputStream.pushText('First prompt');

    // Wait for it to be processed
    await new Promise(resolve => setTimeout(resolve, 50));

    const promptsBeforeQueuing = promptsSubmitted.length;

    // Now queue multiple prompts quickly
    session.inputStream.pushText('Second prompt');
    session.inputStream.pushText('Third prompt');
    session.inputStream.pushText('Fourth prompt');

    // Interrupt immediately before they can be processed
    await session.interrupt();

    // Wait to see if any queued prompts are sent
    await new Promise(resolve => setTimeout(resolve, 100));

    // Check that no additional prompts were sent after interrupt
    const promptsAfterInterrupt = promptsSubmitted.length;
    expect(promptsAfterInterrupt).toBe(promptsBeforeQueuing);

    // Now push a new prompt after interrupt - this should work
    session.inputStream.pushText('Post-interrupt prompt');

    // Wait for the post-interrupt prompt to be processed
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify the post-interrupt prompt was sent
    const postInterruptPrompts = promptsSubmitted.filter(p =>
      p.text === 'Post-interrupt prompt'
    );
    expect(postInterruptPrompts.length).toBe(1);

    // Clean up
    await session.end();
  });

  it('should reset processing flag on interrupt', async () => {
    const mockClient = createMockClient();
    const clientFactory = vi.fn().mockResolvedValue(mockClient);

    const config: StreamingSessionConfig = {
      role: 'driver',
      systemPrompt: 'test',
      directory: '/test',
      model: {
        providerId: 'openrouter',
        modelId: 'google/gemini-2.0-flash-exp',
      },
      includePartialMessages: false,
    };

    const session = new OpencodeStreamingSession(clientFactory, config);

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 50));

    // Interrupt the session
    await session.interrupt();

    // Push a prompt after interrupt - should work immediately
    session.inputStream.pushText('After interrupt');

    // Wait for the prompt to be processed
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify the prompt was processed
    const afterInterruptPrompts = promptsSubmitted.filter(p =>
      p.text === 'After interrupt'
    );
    expect(afterInterruptPrompts.length).toBe(1);

    // Clean up
    await session.end();
  }, 10000);

  it('should handle multiple interrupts gracefully', async () => {
    const mockClient = createMockClient();
    const clientFactory = vi.fn().mockResolvedValue(mockClient);

    const config: StreamingSessionConfig = {
      role: 'driver',
      systemPrompt: 'test',
      directory: '/test',
      model: {
        providerId: 'openrouter',
        modelId: 'google/gemini-2.0-flash-exp',
      },
      includePartialMessages: false,
    };

    const session = new OpencodeStreamingSession(clientFactory, config);

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 50));

    // Multiple interrupts should not cause errors
    await session.interrupt();
    await session.interrupt();
    await session.interrupt();

    // Final prompt after all interrupts
    session.inputStream.pushText('Final prompt');
    await new Promise(resolve => setTimeout(resolve, 100));

    // Should handle multiple interrupts without errors
    // and process the final prompt
    const finalPrompts = promptsSubmitted.filter(p => p.text === 'Final prompt');
    expect(finalPrompts.length).toBe(1);

    // Clean up
    await session.end();
  }, 10000);
});