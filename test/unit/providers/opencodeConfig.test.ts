import { describe, expect, it } from 'vitest';
import { OpenCodeProvider } from '../../../src/providers/embedded/opencode.js';
import type { ProviderConfig } from '../../../src/providers/types.js';

describe('OpenCodeProvider Configuration', () => {
  describe('model configuration', () => {
    it('should accept valid model configuration', () => {
      const config: ProviderConfig = {
        type: 'opencode',
        model: 'openrouter/google/gemini-2.5-flash',
      };

      expect(() => new OpenCodeProvider(config)).not.toThrow();
    });

    it('should throw error when model configuration is missing', () => {
      const config: ProviderConfig = {
        type: 'opencode',
      };

      expect(() => new OpenCodeProvider(config)).toThrow(
        'OpenCode provider requires model configuration'
      );
    });

    it('should throw error when model format is invalid (no slash)', () => {
      const config: ProviderConfig = {
        type: 'opencode',
        model: 'gemini-2.5-flash',
      };

      expect(() => new OpenCodeProvider(config)).toThrow(
        'OpenCode requires full model specification'
      );
    });

    it('should parse model with multiple slashes correctly', () => {
      const config: ProviderConfig = {
        type: 'opencode',
        model: 'openai/gpt-4/turbo',
      };

      // Should not throw
      expect(() => new OpenCodeProvider(config)).not.toThrow();
    });

    it('should parse OpenCode-specific format correctly', () => {
      const config: ProviderConfig = {
        type: 'opencode',
        model: 'openrouter/anthropic/claude-opus-4.1',
      };

      expect(() => new OpenCodeProvider(config)).not.toThrow();
    });

    it('should throw with helpful error message', () => {
      const config: ProviderConfig = {
        type: 'opencode',
        model: 'invalid',
      };

      expect(() => new OpenCodeProvider(config)).toThrow(
        "OpenCode requires full model specification. Got: 'invalid'. Expected format: 'provider/model'"
      );
    });
  });
});