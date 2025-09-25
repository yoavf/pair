import { describe, expect, it } from 'vitest';
import { formatModelName, getRoleDisplayInfo } from '../../../src/utils/modelDisplay.js';
import type { ModelConfig } from '../../../src/providers/types.js';

describe('modelDisplay utilities', () => {
  describe('formatModelName', () => {
    it('should return "sonnet" for claude-code with no model', () => {
      const config: ModelConfig = { provider: 'claude-code', model: undefined };
      expect(formatModelName(config)).toBe('sonnet');
    });

    it('should return "default" for opencode with no model', () => {
      const config: ModelConfig = { provider: 'opencode', model: undefined };
      expect(formatModelName(config)).toBe('default');
    });

    it('should return model as-is for claude-code with model', () => {
      const config: ModelConfig = { provider: 'claude-code', model: 'opus-4.1' };
      expect(formatModelName(config)).toBe('opus-4.1');
    });

    it('should return full model path for opencode', () => {
      const config: ModelConfig = {
        provider: 'opencode',
        model: 'openrouter/google/gemini-2.5-flash'
      };
      expect(formatModelName(config)).toBe('openrouter/google/gemini-2.5-flash');
    });

    it('should handle anthropic opencode models', () => {
      const config: ModelConfig = {
        provider: 'opencode',
        model: 'anthropic/claude-opus-4.1'
      };
      expect(formatModelName(config)).toBe('anthropic/claude-opus-4.1');
    });
  });

  describe('getRoleDisplayInfo', () => {
    it('should return provider and formatted model', () => {
      const config: ModelConfig = {
        provider: 'opencode',
        model: 'openrouter/google/gemini-2.5-flash'
      };

      const result = getRoleDisplayInfo(config);

      expect(result).toEqual({
        provider: 'opencode',
        model: 'openrouter/google/gemini-2.5-flash'
      });
    });

    it('should handle claude-code with default model', () => {
      const config: ModelConfig = { provider: 'claude-code', model: undefined };

      const result = getRoleDisplayInfo(config);

      expect(result).toEqual({
        provider: 'claude-code',
        model: 'sonnet'
      });
    });
  });
});