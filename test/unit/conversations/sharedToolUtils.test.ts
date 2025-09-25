/**
 * Tests for shared tool utilities
 */

import { describe, it, expect } from 'vitest';
import {
	generateMessageId,
	extractResultContent,
	normalizeMcpTool,
	isApprovedEditTool
} from '../../../src/conversations/shared/toolUtils.js';

describe('Shared Tool Utilities', () => {
	describe('generateMessageId', () => {
		it('should generate unique message IDs', () => {
			const ids = new Set();
			for (let i = 0; i < 100; i++) {
				ids.add(generateMessageId());
			}
			// All 100 IDs should be unique
			expect(ids.size).toBe(100);
		});

		it('should generate IDs with consistent format', () => {
			const id = generateMessageId();
			expect(id).toMatch(/^[A-Z0-9]{6,10}$/);
		});

		it('should generate reasonably short IDs', () => {
			const id = generateMessageId();
			expect(id.length).toBeGreaterThanOrEqual(6);
			expect(id.length).toBeLessThanOrEqual(10);
		});
	});

	describe('extractResultContent', () => {
		it('should prioritize text property', () => {
			const item = {
				text: 'primary content',
				content: 'secondary content',
				result: 'tertiary content',
				other: 'ignored'
			};
			expect(extractResultContent(item)).toBe('primary content');
		});

		it('should fall back to content property', () => {
			const item = {
				content: 'secondary content',
				result: 'tertiary content',
				other: 'ignored'
			};
			expect(extractResultContent(item)).toBe('secondary content');
		});

		it('should fall back to result property', () => {
			const item = {
				result: 'tertiary content',
				other: 'ignored'
			};
			expect(extractResultContent(item)).toBe('tertiary content');
		});

		it('should return entire item if no standard properties exist', () => {
			const item = { custom: 'property', foo: 'bar' };
			expect(extractResultContent(item)).toEqual(item);
		});

		it('should handle null and undefined inputs', () => {
			expect(extractResultContent(null)).toBe(null);
			expect(extractResultContent(undefined)).toBe(undefined);
			expect(extractResultContent({})).toEqual({});
		});
	});

	describe('normalizeMcpTool', () => {
		describe('driver role', () => {
			it('should return mcp__driver__ prefixed names unchanged', () => {
				expect(normalizeMcpTool('mcp__driver__driverRequestReview', 'driver'))
					.toBe('mcp__driver__driverRequestReview');
				expect(normalizeMcpTool('mcp__driver__driverRequestGuidance', 'driver'))
					.toBe('mcp__driver__driverRequestGuidance');
			});

			it('should convert pair-driver_ prefix to mcp__driver__', () => {
				expect(normalizeMcpTool('pair-driver_driverRequestReview', 'driver'))
					.toBe('mcp__driver__driverRequestReview');
				expect(normalizeMcpTool('pair-driver_someOtherTool', 'driver'))
					.toBe('mcp__driver__someOtherTool');
			});

			it('should return other tool names unchanged', () => {
				expect(normalizeMcpTool('Read', 'driver')).toBe('Read');
				expect(normalizeMcpTool('Write', 'driver')).toBe('Write');
				expect(normalizeMcpTool('Bash', 'driver')).toBe('Bash');
			});
		});

		describe('navigator role', () => {
			it('should return mcp__navigator__ prefixed names unchanged', () => {
				expect(normalizeMcpTool('mcp__navigator__navigatorApprove', 'navigator'))
					.toBe('mcp__navigator__navigatorApprove');
				expect(normalizeMcpTool('mcp__navigator__navigatorDeny', 'navigator'))
					.toBe('mcp__navigator__navigatorDeny');
				expect(normalizeMcpTool('mcp__navigator__navigatorCodeReview', 'navigator'))
					.toBe('mcp__navigator__navigatorCodeReview');
			});

			it('should convert pair-navigator_ prefix to mcp__navigator__', () => {
				expect(normalizeMcpTool('pair-navigator_navigatorApprove', 'navigator'))
					.toBe('mcp__navigator__navigatorApprove');
				expect(normalizeMcpTool('pair-navigator_someOtherTool', 'navigator'))
					.toBe('mcp__navigator__someOtherTool');
			});

			it('should return other tool names unchanged', () => {
				expect(normalizeMcpTool('Read', 'navigator')).toBe('Read');
				expect(normalizeMcpTool('Grep', 'navigator')).toBe('Grep');
				expect(normalizeMcpTool('Glob', 'navigator')).toBe('Glob');
			});
		});

		describe('custom role', () => {
			it('should handle custom roles correctly', () => {
				expect(normalizeMcpTool('mcp__architect__planCreate', 'architect'))
					.toBe('mcp__architect__planCreate');
				expect(normalizeMcpTool('pair-architect_planCreate', 'architect'))
					.toBe('mcp__architect__planCreate');
				expect(normalizeMcpTool('SomeTool', 'architect'))
					.toBe('SomeTool');
			});
		});

		describe('edge cases', () => {
			it('should handle empty strings', () => {
				expect(normalizeMcpTool('', 'driver')).toBe('');
				expect(normalizeMcpTool('tool', '')).toBe('tool');
			});

			it('should handle special characters in tool names', () => {
				expect(normalizeMcpTool('mcp__driver__tool-with-dashes', 'driver'))
					.toBe('mcp__driver__tool-with-dashes');
				expect(normalizeMcpTool('pair-driver_tool_with_underscores', 'driver'))
					.toBe('mcp__driver__tool_with_underscores');
			});
		});
	});

	describe('isApprovedEditTool', () => {
		it('should identify Write as approved edit tool', () => {
			expect(isApprovedEditTool('Write')).toBe(true);
		});

		it('should identify Edit as approved edit tool', () => {
			expect(isApprovedEditTool('Edit')).toBe(true);
		});

		it('should identify MultiEdit as approved edit tool', () => {
			expect(isApprovedEditTool('MultiEdit')).toBe(true);
		});

		it('should not identify read tools as approved edit tools', () => {
			expect(isApprovedEditTool('Read')).toBe(false);
			expect(isApprovedEditTool('Grep')).toBe(false);
			expect(isApprovedEditTool('Glob')).toBe(false);
		});

		it('should not identify other tools as approved edit tools', () => {
			expect(isApprovedEditTool('Bash')).toBe(false);
			expect(isApprovedEditTool('TodoWrite')).toBe(false);
			expect(isApprovedEditTool('WebSearch')).toBe(false);
			expect(isApprovedEditTool('WebFetch')).toBe(false);
		});

		it('should be case sensitive', () => {
			expect(isApprovedEditTool('write')).toBe(false);
			expect(isApprovedEditTool('WRITE')).toBe(false);
			expect(isApprovedEditTool('edit')).toBe(false);
			expect(isApprovedEditTool('multiedit')).toBe(false);
		});

		it('should not match partial names', () => {
			expect(isApprovedEditTool('WriteFile')).toBe(false);
			expect(isApprovedEditTool('EditText')).toBe(false);
			expect(isApprovedEditTool('MultiEditor')).toBe(false);
		});
	});
});

describe('Shared Utilities Integration', () => {
	it('should work correctly when used together for driver tools', () => {
		// Simulate processing a driver tool
		const toolName = 'pair-driver_driverRequestReview';
		const normalized = normalizeMcpTool(toolName, 'driver');
		expect(normalized).toBe('mcp__driver__driverRequestReview');

		// Check it's not an edit tool
		expect(isApprovedEditTool(normalized)).toBe(false);
	});

	it('should work correctly when used together for navigator tools', () => {
		// Simulate processing a navigator tool
		const toolName = 'pair-navigator_navigatorApprove';
		const normalized = normalizeMcpTool(toolName, 'navigator');
		expect(normalized).toBe('mcp__navigator__navigatorApprove');

		// Check it's not an edit tool
		expect(isApprovedEditTool(normalized)).toBe(false);
	});

	it('should handle edit tools correctly', () => {
		const editTools = ['Write', 'Edit', 'MultiEdit'];
		editTools.forEach(tool => {
			// These should not be normalized (they're not MCP tools)
			expect(normalizeMcpTool(tool, 'driver')).toBe(tool);
			expect(normalizeMcpTool(tool, 'navigator')).toBe(tool);
			// But they should be identified as edit tools
			expect(isApprovedEditTool(tool)).toBe(true);
		});
	});

	it('should generate unique IDs for different messages', () => {
		const messages = [];
		for (let i = 0; i < 10; i++) {
			messages.push({
				id: generateMessageId(),
				content: `Message ${i}`
			});
		}

		const ids = messages.map(m => m.id);
		const uniqueIds = new Set(ids);
		expect(uniqueIds.size).toBe(10);
	});
});