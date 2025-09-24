import { describe, expect, it } from 'vitest';
import { NavigatorUtils } from '../../../src/conversations/navigator/utils.js';
import type { NavigatorCommand } from '../../../src/types.js';

describe('NavigatorUtils', () => {
  describe('extractFailedReviewComment', () => {
    it('should extract comment from failed code review', () => {
      const command: NavigatorCommand = {
        type: 'code_review',
        pass: false,
        comment: 'This needs fixing',
      };

      const result = NavigatorUtils.extractFailedReviewComment(command);
      expect(result).toBe('This needs fixing');
    });

    it('should return default message for failed review without comment', () => {
      const command: NavigatorCommand = {
        type: 'code_review',
        pass: false,
      };

      const result = NavigatorUtils.extractFailedReviewComment(command);
      expect(result).toBe('Please address the review comments and continue.');
    });

    it('should return null for passed code review', () => {
      const command: NavigatorCommand = {
        type: 'code_review',
        pass: true,
        comment: 'Looks good',
      };

      const result = NavigatorUtils.extractFailedReviewComment(command);
      expect(result).toBeNull();
    });

    it('should return null for non-review commands', () => {
      const command: NavigatorCommand = {
        type: 'approve',
        comment: 'Approved',
      };

      const result = NavigatorUtils.extractFailedReviewComment(command);
      expect(result).toBeNull();
    });
  });

  describe('shouldEndSession', () => {
    it('should return true for complete command', () => {
      const command: NavigatorCommand = {
        type: 'complete',
        summary: 'Task completed',
      };

      expect(NavigatorUtils.shouldEndSession(command)).toBe(true);
    });

    it('should return true for passed code review', () => {
      const command: NavigatorCommand = {
        type: 'code_review',
        pass: true,
        comment: 'All good',
      };

      expect(NavigatorUtils.shouldEndSession(command)).toBe(true);
    });

    it('should return false for failed code review', () => {
      const command: NavigatorCommand = {
        type: 'code_review',
        pass: false,
        comment: 'Needs work',
      };

      expect(NavigatorUtils.shouldEndSession(command)).toBe(false);
    });

    it('should return false for approve/deny commands', () => {
      const approveCommand: NavigatorCommand = {
        type: 'approve',
        comment: 'Approved',
      };

      const denyCommand: NavigatorCommand = {
        type: 'deny',
        comment: 'Denied',
      };

      expect(NavigatorUtils.shouldEndSession(approveCommand)).toBe(false);
      expect(NavigatorUtils.shouldEndSession(denyCommand)).toBe(false);
    });
  });

  describe('isDecisionTool', () => {
    it('should return true for approve tool', () => {
      expect(NavigatorUtils.isDecisionTool('mcp__navigator__navigatorApprove')).toBe(true);
    });

    it('should return true for deny tool', () => {
      expect(NavigatorUtils.isDecisionTool('mcp__navigator__navigatorDeny')).toBe(true);
    });

    it('should return false for other tools', () => {
      expect(NavigatorUtils.isDecisionTool('mcp__navigator__navigatorCodeReview')).toBe(false);
      expect(NavigatorUtils.isDecisionTool('mcp__navigator__navigatorComplete')).toBe(false);
      expect(NavigatorUtils.isDecisionTool('Read')).toBe(false);
    });
  });

  describe('normalizeNavigatorTool', () => {
    it('should normalize approve variants', () => {
      expect(NavigatorUtils.normalizeNavigatorTool('approve')).toBe('mcp__navigator__navigatorApprove');
      expect(NavigatorUtils.normalizeNavigatorTool('navigator_approve')).toBe('mcp__navigator__navigatorApprove');
    });

    it('should normalize deny variants', () => {
      expect(NavigatorUtils.normalizeNavigatorTool('deny')).toBe('mcp__navigator__navigatorDeny');
      expect(NavigatorUtils.normalizeNavigatorTool('navigator_deny')).toBe('mcp__navigator__navigatorDeny');
    });

    it('should normalize review variants', () => {
      expect(NavigatorUtils.normalizeNavigatorTool('review')).toBe('mcp__navigator__navigatorCodeReview');
      expect(NavigatorUtils.normalizeNavigatorTool('code_review')).toBe('mcp__navigator__navigatorCodeReview');
    });

    it('should normalize complete variants', () => {
      expect(NavigatorUtils.normalizeNavigatorTool('complete')).toBe('mcp__navigator__navigatorComplete');
      expect(NavigatorUtils.normalizeNavigatorTool('navigator_complete')).toBe('mcp__navigator__navigatorComplete');
    });

    it('should return original tool name if no match', () => {
      expect(NavigatorUtils.normalizeNavigatorTool('Read')).toBe('Read');
      expect(NavigatorUtils.normalizeNavigatorTool('Bash')).toBe('Bash');
    });
  });
});