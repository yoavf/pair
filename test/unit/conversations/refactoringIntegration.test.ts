/**
 * Integration tests for refactored driver and navigator modules
 * Ensures that the refactoring maintains correct behavior
 */

import { describe, it, expect } from 'vitest';
import { normalizeDriverTool } from '../../../src/conversations/driver/toolUtils.js';
import { normalizeMcpTool } from '../../../src/conversations/shared/toolUtils.js';

describe('Refactoring Integration Tests', () => {
	describe('Driver and Navigator tool normalization consistency', () => {
		it('should normalize driver tools consistently', () => {
			// Test that driver's wrapper function produces same results as direct shared function
			const testCases = [
				'mcp__driver__driverRequestReview',
				'pair-driver_driverRequestGuidance',
				'Read',
				'Write',
				'Bash'
			];

			testCases.forEach(toolName => {
				const driverResult = normalizeDriverTool(toolName);
				const sharedResult = normalizeMcpTool(toolName, 'driver');
				expect(driverResult).toBe(sharedResult);
			});
		});

		it('should handle legacy prefixes correctly for both agents', () => {
			// Driver legacy prefix
			expect(normalizeDriverTool('pair-driver_someCommand'))
				.toBe('mcp__driver__someCommand');

			// Navigator would use similar pattern (via Navigator.normalizeNavigatorTool)
			expect(normalizeMcpTool('pair-navigator_someCommand', 'navigator'))
				.toBe('mcp__navigator__someCommand');
		});

		it('should not modify standard tool names', () => {
			const standardTools = ['Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'Grep', 'Glob'];

			standardTools.forEach(tool => {
				// Driver should not modify standard tools
				expect(normalizeDriverTool(tool)).toBe(tool);
				// Shared function should also not modify them
				expect(normalizeMcpTool(tool, 'driver')).toBe(tool);
				expect(normalizeMcpTool(tool, 'navigator')).toBe(tool);
			});
		});
	});

	describe('Cross-module consistency', () => {
		it('should maintain consistent tool identification across modules', async () => {
			// Import both driver and shared versions
			const { isApprovedEditTool: driverVersion } =
				await import('../../../src/conversations/driver/toolUtils.js');
			const { isApprovedEditTool: sharedVersion } =
				await import('../../../src/conversations/shared/toolUtils.js');

			const testTools = [
				{ name: 'Write', expected: true },
				{ name: 'Edit', expected: true },
				{ name: 'MultiEdit', expected: true },
				{ name: 'Read', expected: false },
				{ name: 'Bash', expected: false },
			];

			testTools.forEach(({ name, expected }) => {
				// Both versions should give same result
				expect(driverVersion(name)).toBe(expected);
				expect(sharedVersion(name)).toBe(expected);
			});
		});

		it('should generate consistent message ID format', async () => {
			// Import both driver and shared versions
			const { generateMessageId: driverVersion } =
				await import('../../../src/conversations/driver/toolUtils.js');
			const { generateMessageId: sharedVersion } =
				await import('../../../src/conversations/shared/toolUtils.js');

			// Generate IDs from both
			const driverId = driverVersion();
			const sharedId = sharedVersion();

			// Both should match the same pattern
			const idPattern = /^[A-Z0-9]{6,10}$/;
			expect(driverId).toMatch(idPattern);
			expect(sharedId).toMatch(idPattern);

			// They should be different (unique)
			expect(driverId).not.toBe(sharedId);
		});

		it('should extract result content consistently', async () => {
			// Import both driver and shared versions
			const { extractResultContent: driverVersion } =
				await import('../../../src/conversations/driver/toolUtils.js');
			const { extractResultContent: sharedVersion } =
				await import('../../../src/conversations/shared/toolUtils.js');

			const testCases = [
				{ input: { text: 'content' }, expected: 'content' },
				{ input: { content: 'data' }, expected: 'data' },
				{ input: { result: 'output' }, expected: 'output' },
				{ input: { custom: 'field' }, expected: { custom: 'field' } },
			];

			testCases.forEach(({ input, expected }) => {
				expect(driverVersion(input)).toEqual(expected);
				expect(sharedVersion(input)).toEqual(expected);
			});
		});
	});

	describe('Backward compatibility', () => {
		it('should maintain Driver static method compatibility', async () => {
			// These methods should still be accessible as static methods on Driver
			const { Driver } = await import('../../../src/conversations/Driver.js');

			// Check that static methods still exist
			expect(typeof Driver.hasRequestReview).toBe('function');
			expect(typeof Driver.combineMessagesForNavigator).toBe('function');

			// Test combineMessagesForNavigator
			expect(Driver.combineMessagesForNavigator([])).toBe('');
			expect(Driver.combineMessagesForNavigator(['test'])).toBe('test');
			expect(Driver.combineMessagesForNavigator(['a', 'b']))
				.toBe('\na\n\n\nb');
		});

		it('should maintain Navigator static method compatibility', async () => {
			// These methods should still be accessible
			const { Navigator } = await import('../../../src/conversations/Navigator.js');

			// Check that static methods still exist
			expect(typeof Navigator.extractFailedReviewComment).toBe('function');
			expect(typeof Navigator.shouldEndSession).toBe('function');
			expect(typeof Navigator.coerceReviewCommand).toBe('function');
			expect(typeof Navigator.normalizeDecisionCommand).toBe('function');
		});
	});
});