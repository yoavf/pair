import { describe, expect, it } from 'vitest';
import { validateConfig } from '../../src/utils/config.js';
import type { AppConfig } from '../../src/utils/config.js';

describe('validateConfig', () => {
  const baseConfig: AppConfig = {
    navigatorMaxTurns: 50,
    driverMaxTurns: 20,
    maxPromptLength: 10000,
    maxPromptFileSize: 100 * 1024,
    sessionHardLimitMs: 30 * 60 * 1000,
    enableSyncStatus: true,
    architectConfig: { provider: 'claude-code', model: 'opus-4.1' },
    navigatorConfig: { provider: 'claude-code', model: undefined },
    driverConfig: { provider: 'claude-code', model: undefined },
  };

  it('should accept valid configuration', () => {
    expect(() => validateConfig(baseConfig, ['claude-code', 'opencode'])).not.toThrow();
  });

  it('should reject invalid navigator max turns', () => {
    const invalidConfig = { ...baseConfig, navigatorMaxTurns: 5 };
    expect(() => validateConfig(invalidConfig)).toThrow('Navigator max turns must be between 10 and 100');
  });

  it('should reject invalid driver max turns', () => {
    const invalidConfig = { ...baseConfig, driverMaxTurns: 100 };
    expect(() => validateConfig(invalidConfig)).toThrow('Driver max turns must be between 5 and 50');
  });

  it('should reject invalid max prompt length', () => {
    const invalidConfig = { ...baseConfig, maxPromptLength: 100000 };
    expect(() => validateConfig(invalidConfig)).toThrow('Max prompt length must be between 10 and 50,000 characters');
  });

  it('should reject invalid max prompt file size', () => {
    const invalidConfig = { ...baseConfig, maxPromptFileSize: 10 * 1024 * 1024 };
    expect(() => validateConfig(invalidConfig)).toThrow('Max prompt file size must be between 1KB and 1MB');
  });

  it('should reject invalid session hard limit', () => {
    const invalidConfig = { ...baseConfig, sessionHardLimitMs: 30000 };
    expect(() => validateConfig(invalidConfig)).toThrow('Session hard limit must be between 1 minute and 8 hours');
  });

  it('should reject unknown provider', () => {
    const invalidConfig = {
      ...baseConfig,
      architectConfig: { provider: 'unknown-provider', model: undefined },
    };
    expect(() => validateConfig(invalidConfig, ['claude-code', 'opencode'])).toThrow(
      'Unknown architect provider type: "unknown-provider"'
    );
  });

  it('should reject OpenCode without model', () => {
    const invalidConfig = {
      ...baseConfig,
      navigatorConfig: { provider: 'opencode', model: undefined },
    };
    expect(() => validateConfig(invalidConfig, ['claude-code', 'opencode'])).toThrow(
      'OpenCode provider requires a model'
    );
  });

  it('should accept OpenCode provider with model', () => {
    const validConfig = {
      ...baseConfig,
      navigatorConfig: { provider: 'opencode', model: 'openrouter/gemini-2.5-flash' },
    };
    expect(() => validateConfig(validConfig, ['claude-code', 'opencode'])).not.toThrow();
  });
});