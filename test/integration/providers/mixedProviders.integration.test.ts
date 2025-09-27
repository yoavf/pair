/**
 * Simple integration tests for provider scenarios
 */

import { describe, test, expect } from 'vitest';
import { agentProviderFactory } from '../../../src/providers/factory.js';
import { validateConfig } from '../../../src/utils/config.js';
import type { AppConfig } from '../../../src/utils/config.js';

describe('Provider Integration', () => {
	test('should create different provider types', () => {
		const claudeProvider = agentProviderFactory.createProvider({
			type: 'claude-code'
		});

		const openCodeProvider = agentProviderFactory.createProvider({
			type: 'opencode',
			model: 'openrouter/google/gemini-2.5-flash'
		});

		expect(claudeProvider.name).toBe('claude-code');
		expect(openCodeProvider.name).toBe('opencode');
		expect(claudeProvider.type).toBe('embedded');
		expect(openCodeProvider.type).toBe('embedded');
	});

	test('should validate mixed provider configuration', () => {
		const config: AppConfig = {
			navigatorMaxTurns: 50,
			driverMaxTurns: 20,
			maxPromptLength: 10000,
			maxPromptFileSize: 100 * 1024,
			sessionHardLimitMs: 30 * 60 * 1000,
			enableSyncStatus: true,
			navigatorConfig: { provider: 'opencode', model: 'openrouter/google/gemini-2.5-flash' },
			driverConfig: { provider: 'claude-code', model: undefined },
		};

		const availableProviders = agentProviderFactory.getAvailableProviders();
		expect(() => validateConfig(config, availableProviders)).not.toThrow();
	});

	test('should reject unknown provider types', () => {
		const config: AppConfig = {
			navigatorMaxTurns: 50,
			driverMaxTurns: 20,
			maxPromptLength: 10000,
			maxPromptFileSize: 100 * 1024,
			sessionHardLimitMs: 30 * 60 * 1000,
			enableSyncStatus: true,
			navigatorConfig: { provider: 'invalid-provider', model: undefined },
			driverConfig: { provider: 'claude-code', model: undefined },
		};

		const availableProviders = agentProviderFactory.getAvailableProviders();
		expect(() => validateConfig(config, availableProviders)).toThrow();
	});
});