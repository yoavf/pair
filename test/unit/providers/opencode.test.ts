import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenCodeProvider } from '../../../src/providers/embedded/opencode.js';
import type { StreamingSessionOptions } from '../../../src/providers/types.js';

interface ServerHandleRecord {
  options: any;
  handle: { url: string; close: ReturnType<typeof vi.fn> };
}

interface ClientHandleRecord {
  baseUrl: string;
}

const serverHandles: ServerHandleRecord[] = [];
const clientHandles: ClientHandleRecord[] = [];

function createEmptyAsyncStream() {
  return (async function* () {
    return;
  })();
}

function createMockClient(baseUrl: string) {
  const sessionId = `session-${Math.random().toString(36).slice(2, 8)}`;

  return {
    __baseUrl: baseUrl,
    session: {
      create: vi.fn().mockResolvedValue({
        data: { id: sessionId, title: 'pair-session' },
      }),
      prompt: vi.fn().mockResolvedValue({ data: {} }),
      abort: vi.fn().mockResolvedValue({ data: {} }),
    },
    event: {
      subscribe: vi.fn().mockResolvedValue({ stream: createEmptyAsyncStream() }),
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
    permission: {
      update: vi.fn().mockResolvedValue({ data: {} }),
    },
    message: {
      get: vi.fn().mockResolvedValue({ data: {} }),
    },
  };
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

vi.mock('@opencode-ai/sdk', () => {
  return {
    createOpencodeServer: vi.fn(async (options: any) => {
      const handle = {
        url: `http://127.0.0.1:${9000 + serverHandles.length}`,
        close: vi.fn(),
      };
      serverHandles.push({ options, handle });
      return handle;
    }),
    createOpencodeClient: vi.fn((args: { baseUrl: string }) => {
      const client = createMockClient(args.baseUrl);
      clientHandles.push({ baseUrl: args.baseUrl });
      return client as any;
    }),
  };
});

import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk';

const mockedCreateOpencodeServer = vi.mocked(createOpencodeServer);
const mockedCreateOpencodeClient = vi.mocked(createOpencodeClient);

function buildStreamingOptions(
  overrides: Partial<StreamingSessionOptions>,
): StreamingSessionOptions {
  return {
    systemPrompt: overrides.systemPrompt ?? 'prompt',
    allowedTools: overrides.allowedTools ?? ['all'],
    additionalMcpTools: overrides.additionalMcpTools ?? [],
    maxTurns: overrides.maxTurns ?? 5,
    projectPath: overrides.projectPath ?? '/repo',
    mcpServerUrl: overrides.mcpServerUrl ?? 'http://localhost:4097/mcp/role',
    embeddedMcpServer: overrides.embeddedMcpServer,
    mcpRole: overrides.mcpRole ?? 'driver',
    canUseTool: overrides.canUseTool,
    disallowedTools: overrides.disallowedTools ?? [],
    includePartialMessages: overrides.includePartialMessages,
    diagnosticLogger: overrides.diagnosticLogger,
  };
}

beforeEach(() => {
  serverHandles.length = 0;
  clientHandles.length = 0;
  vi.clearAllMocks();
  delete process.env.OPENCODE_START_SERVER;
  delete process.env.OPENCODE_BASE_URL;
});

afterEach(() => {
  delete process.env.OPENCODE_START_SERVER;
  delete process.env.OPENCODE_BASE_URL;
});

describe('OpenCodeProvider', () => {
  it('starts a dedicated server for driver sessions with project working directory', async () => {
    process.env.OPENCODE_START_SERVER = 'true';

    const provider = new OpenCodeProvider({ type: 'opencode', model: 'openrouter/google/gemini-2.5-flash' });
    const session = provider.createStreamingSession(
      buildStreamingOptions({
        projectPath: '/repo/driver',
        mcpServerUrl: 'http://localhost:7000/mcp/driver',
        mcpRole: 'driver',
      }),
    );

    await flushAsync();
    expect(mockedCreateOpencodeServer).toHaveBeenCalledTimes(1);

    const serverCall = serverHandles[0];
    expect(serverCall.options.port).toBe(0);
    expect(serverCall.options.config?.path?.worktree).toBe('/repo/driver');
    expect(serverCall.options.config?.path?.directory).toBe('/repo/driver');
    expect(serverCall.options.config?.mcp?.['pair-driver']).toEqual({
      type: 'remote',
      url: 'http://localhost:7000/mcp/driver',
      enabled: true,
    });
    expect(clientHandles[0]?.baseUrl).toBe(serverCall.handle.url);

    await session.end();
    await flushAsync();
    expect(serverCall.handle.close).toHaveBeenCalledTimes(1);
    await provider.cleanup();
  });

  it('starts separate servers for navigator and driver roles with distinct MCP configs', async () => {
    process.env.OPENCODE_START_SERVER = 'true';

    const provider = new OpenCodeProvider({ type: 'opencode', model: 'openrouter/google/gemini-2.5-flash' });
    const driverSession = provider.createStreamingSession(
      buildStreamingOptions({
        projectPath: '/repo/driver',
        mcpServerUrl: 'http://localhost:7010/mcp/driver',
        mcpRole: 'driver',
      }),
    );
    const navigatorSession = provider.createStreamingSession(
      buildStreamingOptions({
        projectPath: '/repo/navigator',
        mcpServerUrl: 'http://localhost:7011/mcp/navigator',
        mcpRole: 'navigator',
      }),
    );

    await flushAsync();
    expect(mockedCreateOpencodeServer).toHaveBeenCalledTimes(2);

    const driverCall = serverHandles.find((record) => record.options.config?.mcp?.['pair-driver']);
    const navigatorCall = serverHandles.find((record) => record.options.config?.mcp?.['pair-navigator']);

    expect(driverCall?.options.config?.mcp?.['pair-driver']?.url).toBe('http://localhost:7010/mcp/driver');
    expect(navigatorCall?.options.config?.mcp?.['pair-navigator']?.url).toBe('http://localhost:7011/mcp/navigator');
    expect(driverCall && navigatorCall && driverCall.handle).not.toBe(navigatorCall?.handle);

    await driverSession.end();
    await navigatorSession.end();

    await flushAsync();
    expect(driverCall?.handle.close).toHaveBeenCalledTimes(1);
    expect(navigatorCall?.handle.close).toHaveBeenCalledTimes(1);

    await provider.cleanup();
  });

  it('does not start a server when startServer is disabled and uses provided base URL', async () => {
    process.env.OPENCODE_START_SERVER = 'false';
    process.env.OPENCODE_BASE_URL = 'http://external-opencode';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const provider = new OpenCodeProvider({ type: 'opencode', model: 'openrouter/google/gemini-2.5-flash' });
    const session = provider.createStreamingSession(
      buildStreamingOptions({
        projectPath: '/repo/external',
        mcpServerUrl: 'http://localhost:7012/mcp/driver',
        mcpRole: 'driver',
      }),
    );

    await flushAsync();
    expect(mockedCreateOpencodeClient).toHaveBeenCalledTimes(1);
    expect(mockedCreateOpencodeServer).not.toHaveBeenCalled();
    expect(clientHandles[0]?.baseUrl).toBe('http://external-opencode');
    expect(warnSpy).toHaveBeenCalled();

    await session.end();
    await provider.cleanup();
    warnSpy.mockRestore();
  });
});
