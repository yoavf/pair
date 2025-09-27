/**
 * Tests for Driver utility modules
 */

import { describe, it, expect } from 'vitest';
import {
	normalizeAssistantText,
	combineMessagesForNavigator
} from '../../../src/conversations/driver/textProcessor.js';
import {
	generateMessageId,
	normalizeDriverTool,
	isApprovedEditTool,
	extractResultContent
} from '../../../src/conversations/driver/toolUtils.js';
import {
	convertMcpToolToDriverCommand,
	hasRequestReview
} from '../../../src/conversations/driver/commandUtils.js';

describe('Driver Text Processing Utilities', () => {
	describe('normalizeAssistantText', () => {
		it('should normalize line breaks and whitespace', () => {
			const input = "Hello\n\n\nWorld\r\n  Multiple   spaces";
			const result = normalizeAssistantText(input);
			expect(result).toBe("Hello\n\nWorld Multiple spaces");
		});

		it('should handle empty string', () => {
			expect(normalizeAssistantText('')).toBe('');
		});

		it('should preserve single line breaks but collapse multiple ones', () => {
			const input = "Line 1\nLine 2\n\n\nLine 3";
			const result = normalizeAssistantText(input);
			expect(result).toBe("Line 1 Line 2\n\nLine 3");
		});
	});

	describe('combineMessagesForNavigator', () => {
		it('should return empty string for empty array', () => {
			expect(combineMessagesForNavigator([])).toBe('');
		});

		it('should return single message as-is', () => {
			expect(combineMessagesForNavigator(['Single message'])).toBe('Single message');
		});

		it('should combine multiple messages with proper formatting', () => {
			const messages = ['First', 'Second', 'Third'];
			const result = combineMessagesForNavigator(messages);
			expect(result).toBe('\nFirst\n\n\nSecond\n\n\nThird');
		});
	});
});

describe('Driver Tool Utilities', () => {
	describe('generateMessageId', () => {
		it('should generate unique message IDs', () => {
			const id1 = generateMessageId();
			const id2 = generateMessageId();
			expect(id1).not.toBe(id2);
			expect(id1).toMatch(/^[A-Z0-9]+$/);
			expect(id2).toMatch(/^[A-Z0-9]+$/);
		});

		it('should generate reasonably short IDs', () => {
			const id = generateMessageId();
			expect(id.length).toBeGreaterThan(4);
			expect(id.length).toBeLessThan(12);
		});
	});

	describe('normalizeDriverTool', () => {
		it('should return mcp__driver__ prefixed names unchanged', () => {
			expect(normalizeDriverTool('mcp__driver__driverRequestReview'))
				.toBe('mcp__driver__driverRequestReview');
		});

		it('should convert pair-driver_ prefix to mcp__driver__', () => {
			expect(normalizeDriverTool('pair-driver_driverRequestReview'))
				.toBe('mcp__driver__driverRequestReview');
		});

		it('should return other tool names unchanged', () => {
			expect(normalizeDriverTool('SomeOtherTool')).toBe('SomeOtherTool');
		});
	});

	describe('isApprovedEditTool', () => {
		it('should identify Write, Edit, MultiEdit as approved edit tools', () => {
			expect(isApprovedEditTool('Write')).toBe(true);
			expect(isApprovedEditTool('Edit')).toBe(true);
			expect(isApprovedEditTool('MultiEdit')).toBe(true);
		});

		it('should not identify other tools as approved edit tools', () => {
			expect(isApprovedEditTool('Read')).toBe(false);
			expect(isApprovedEditTool('Bash')).toBe(false);
			expect(isApprovedEditTool('Grep')).toBe(false);
		});
	});

	describe('extractResultContent', () => {
		it('should extract text property if present', () => {
			expect(extractResultContent({ text: 'content', other: 'ignored' }))
				.toBe('content');
		});

		it('should extract content property if text not present', () => {
			expect(extractResultContent({ content: 'data', other: 'ignored' }))
				.toBe('data');
		});

		it('should extract result property if text and content not present', () => {
			expect(extractResultContent({ result: 'output', other: 'ignored' }))
				.toBe('output');
		});

		it('should return entire item if no known properties present', () => {
			const item = { custom: 'property' };
			expect(extractResultContent(item)).toEqual(item);
		});
	});
});

describe('Driver Command Utilities', () => {
	describe('convertMcpToolToDriverCommand', () => {
		it('should convert driverRequestReview tool to request_review command', () => {
			const result = convertMcpToolToDriverCommand(
				'mcp__driver__driverRequestReview',
				{ context: 'Please review my changes' }
			);
			expect(result).toEqual({
				type: 'request_review',
				context: 'Please review my changes'
			});
		});

		it('should convert driverRequestGuidance tool to request_guidance command', () => {
			const result = convertMcpToolToDriverCommand(
				'mcp__driver__driverRequestGuidance',
				{ context: 'Need help with this' }
			);
			expect(result).toEqual({
				type: 'request_guidance',
				context: 'Need help with this'
			});
		});

		it('should handle pair-driver_ prefix', () => {
			const result = convertMcpToolToDriverCommand(
				'pair-driver_driverRequestReview',
				{ context: 'Review needed' }
			);
			expect(result).toEqual({
				type: 'request_review',
				context: 'Review needed'
			});
		});

		it('should return null for unknown tools', () => {
			const result = convertMcpToolToDriverCommand(
				'mcp__driver__unknownTool',
				{ context: 'test' }
			);
			expect(result).toBeNull();
		});
	});

	describe('hasRequestReview', () => {
		it('should return null (legacy method now handled by MCP)', () => {
			expect(hasRequestReview(['message1', 'message2'])).toBeNull();
			expect(hasRequestReview([])).toBeNull();
		});
	});
});