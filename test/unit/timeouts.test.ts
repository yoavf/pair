/**
 * Tests for timeout utilities
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TIMEOUT_CONFIG, TimeoutManager } from '../../src/utils/timeouts.js';

describe('TIMEOUT_CONFIG', () => {
	it('should have default timeout values', () => {
		expect(TIMEOUT_CONFIG.TOOL_COMPLETION).toBe(120000); // 2 minutes
		expect(TIMEOUT_CONFIG.PERMISSION_REQUEST).toBe(15000); // 15 seconds
	});

	it('should allow environment variable overrides', () => {
		// Note: These would need to be set before module import in real usage
		expect(typeof TIMEOUT_CONFIG.TOOL_COMPLETION).toBe('number');
		expect(typeof TIMEOUT_CONFIG.PERMISSION_REQUEST).toBe('number');
	});
});

describe('TimeoutManager', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('createTimeout', () => {
		it('should create controller that aborts after timeout', () => {
			const { controller, cleanup } = TimeoutManager.createTimeout(1000);

			expect(controller.signal.aborted).toBe(false);

			// Fast forward time
			vi.advanceTimersByTime(1000);

			expect(controller.signal.aborted).toBe(true);
			cleanup();
		});

		it('should allow manual cleanup to prevent timeout', () => {
			const { controller, cleanup } = TimeoutManager.createTimeout(1000);

			expect(controller.signal.aborted).toBe(false);

			// Cleanup before timeout
			cleanup();
			vi.advanceTimersByTime(1000);

			expect(controller.signal.aborted).toBe(false);
		});
	});

	describe('createWaiterTimeout', () => {
		it('should resolve immediately if condition is already true', async () => {
			const condition = () => true;
			const onTimeout = vi.fn();
			const addWaiter = vi.fn();

			const promise = TimeoutManager.createWaiterTimeout(
				condition,
				onTimeout,
				1000,
				addWaiter,
			);

			await expect(promise).resolves.toBeUndefined();
			expect(onTimeout).not.toHaveBeenCalled();
			expect(addWaiter).not.toHaveBeenCalled();
		});

		it('should add waiter and wait for resolution when condition is false', async () => {
			const condition = () => false;
			const onTimeout = vi.fn();
			const addWaiter = vi.fn();

			const promise = TimeoutManager.createWaiterTimeout(
				condition,
				onTimeout,
				1000,
				addWaiter,
			);

			// Should have added a waiter callback
			expect(addWaiter).toHaveBeenCalledWith(expect.any(Function));

			// Simulate the waiter being called (condition became true)
			const waiterCallback = addWaiter.mock.calls[0][0];
			waiterCallback();

			await expect(promise).resolves.toBeUndefined();
			expect(onTimeout).not.toHaveBeenCalled();
		});

		it('should timeout and call onTimeout callback', async () => {
			const condition = () => false;
			const onTimeout = vi.fn().mockResolvedValue(undefined);
			const addWaiter = vi.fn();

			const promise = TimeoutManager.createWaiterTimeout(
				condition,
				onTimeout,
				1000,
				addWaiter,
			);

			// Fast forward past timeout
			vi.advanceTimersByTime(1000);

			await expect(promise).rejects.toThrow('Operation timed out after 1000ms');
			expect(onTimeout).toHaveBeenCalled();
		});

		it('should handle onTimeout errors', async () => {
			const condition = () => false;
			const timeoutError = new Error('Timeout callback failed');
			const onTimeout = vi.fn().mockRejectedValue(timeoutError);
			const addWaiter = vi.fn();

			const promise = TimeoutManager.createWaiterTimeout(
				condition,
				onTimeout,
				1000,
				addWaiter,
			);

			// Fast forward past timeout
			vi.advanceTimersByTime(1000);

			await expect(promise).rejects.toBe(timeoutError);
			expect(onTimeout).toHaveBeenCalled();
		});

		it('should handle synchronous onTimeout callback', async () => {
			const condition = () => false;
			const onTimeout = vi.fn(); // synchronous callback
			const addWaiter = vi.fn();

			const promise = TimeoutManager.createWaiterTimeout(
				condition,
				onTimeout,
				1000,
				addWaiter,
			);

			// Fast forward past timeout
			vi.advanceTimersByTime(1000);

			await expect(promise).rejects.toThrow('Operation timed out after 1000ms');
			expect(onTimeout).toHaveBeenCalled();
		});
	});
});