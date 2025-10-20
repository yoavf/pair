import { describe, expect, it, vi } from 'vitest';
import { Driver } from '../../../src/conversations/Driver.js';
import type { EmbeddedAgentProvider } from '../../../src/providers/types.js';
import type { Logger } from '../../../src/utils/logger.js';

describe('Driver permission handling', () => {
	it('clears pending tool and resolves batch when permission is denied', async () => {
		const streamingSessionStub = {
			interrupt: vi.fn(),
			inputStream: { pushText: vi.fn() },
			// Minimal async iterator implementation
			[Symbol.asyncIterator]: () => ({
				next: async () => ({ done: true, value: undefined }),
			}),
		};

		const providerMock = {
			name: 'test-provider',
			createStreamingSession: vi.fn().mockReturnValue(streamingSessionStub),
		} as unknown as EmbeddedAgentProvider;

		const loggerMock = {
			logEvent: vi.fn(),
			logToolUse: vi.fn(),
			logToolResult: vi.fn(),
			logAgentCommunication: vi.fn(),
		} as unknown as Logger;

		const driver = new Driver(
			'system prompt',
			['Edit'],
			10,
			'/tmp/project',
			loggerMock,
			providerMock,
		);

		const internalDriver = driver as unknown as {
			pendingTools: Set<string>;
			pendingTexts: string[];
			batchResolvers: Array<(messages: string[]) => void>;
		};

		internalDriver.pendingTools.add('call_denied');
		internalDriver.pendingTexts = ['Update README\n'];

		const batchPromise = new Promise<string[]>((resolve) => {
			internalDriver.batchResolvers.push(resolve);
		});

		driver.handlePermissionDenied('call_denied');

		const batch = await batchPromise;

		expect(batch).toEqual(['Update README\n']);
		expect(internalDriver.pendingTools.size).toBe(0);
		expect(internalDriver.pendingTexts).toEqual([]);
		expect(loggerMock.logEvent).toHaveBeenNthCalledWith(
			1,
			'DRIVER_PERMISSION_DENIED_CLEARED',
			expect.objectContaining({ toolUseId: 'call_denied' }),
			);
			expect(loggerMock.logEvent).toHaveBeenNthCalledWith(
				2,
				'DRIVER_INTERMEDIATE_BATCH',
				expect.objectContaining({
					messageCount: 1,
					source: 'permission_denied',
				}),
			);
		});

	it('registers driver request review commands immediately', async () => {
		const streamingSessionStub = {
			interrupt: vi.fn(),
			inputStream: { pushText: vi.fn() },
			[Symbol.asyncIterator]: () => ({
				next: async () => ({ done: true, value: undefined }),
			}),
		};

		const providerMock = {
			name: 'test-provider',
			createStreamingSession: vi.fn().mockReturnValue(streamingSessionStub),
		} as unknown as EmbeddedAgentProvider;

		const loggerMock = {
			logEvent: vi.fn(),
			logToolUse: vi.fn(),
			logToolResult: vi.fn(),
			logAgentCommunication: vi.fn(),
		} as unknown as Logger;

		const driver = new Driver(
			'system prompt',
			['Edit'],
			10,
			'/tmp/project',
			loggerMock,
			providerMock,
		);

		const internalDriver = driver as unknown as {
			pendingTools: Set<string>;
			pendingTexts: string[];
			batchResolvers: Array<(messages: string[]) => void>;
		};

		internalDriver.pendingTools.add('call_review');
		internalDriver.pendingTexts = ['🔍 Requesting review: context\n'];

		const batchPromise = new Promise<string[]>((resolve) => {
			internalDriver.batchResolvers.push(resolve);
		});

		(driver as unknown as { handleDriverCommandTool: (id: string, name: string, input: Record<string, unknown>) => void })
			.handleDriverCommandTool('call_review', 'mcp__driver__driverRequestReview', {
				context: 'context',
			});

		const batch = await batchPromise;
		const commands = driver.getAndClearDriverCommands();

		expect(batch).toEqual(['🔍 Requesting review: context\n']);
		expect(commands).toEqual([
			{ type: 'request_review', context: 'context' },
		]);
		expect(loggerMock.logEvent).toHaveBeenNthCalledWith(
			1,
			'DRIVER_MCP_COMMAND',
			expect.objectContaining({ type: 'request_review' }),
		);
		expect(loggerMock.logEvent).toHaveBeenNthCalledWith(
			2,
			'DRIVER_INTERMEDIATE_BATCH',
			expect.objectContaining({
				messageCount: 1,
				source: 'driver_command',
			}),
		);
	});
});
