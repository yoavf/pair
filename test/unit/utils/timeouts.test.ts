import { describe, expect, it, beforeEach, vi } from "vitest";
import { TimeoutError } from "p-timeout";
import {
	TIMEOUT_CONFIG,
	createTimeout,
	waitForCondition,
	withTimeout,
} from "../../../src/utils/timeouts.js";

describe("Timeout Utilities", () => {
	beforeEach(() => {
		vi.clearAllTimers();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("TIMEOUT_CONFIG", () => {
		it("should have default timeout values", () => {
			expect(TIMEOUT_CONFIG.TOOL_COMPLETION).toBe(120000);
			expect(TIMEOUT_CONFIG.PERMISSION_REQUEST).toBe(45000);
		});
	});

	describe("createTimeout", () => {
		it("should create timeout with AbortController", () => {
			const { controller, cleanup } = createTimeout(1000);

			expect(controller).toBeInstanceOf(AbortController);
			expect(controller.signal.aborted).toBe(false);
			expect(typeof cleanup).toBe("function");

			// Test timeout triggers abort
			vi.advanceTimersByTime(1000);
			expect(controller.signal.aborted).toBe(true);

			cleanup();
		});

		it("should allow cleanup before timeout", () => {
			const { controller, cleanup } = createTimeout(1000);

			cleanup();
			vi.advanceTimersByTime(1000);

			expect(controller.signal.aborted).toBe(false);
		});
	});

	describe("waitForCondition", () => {
		it("should resolve immediately if condition is true", async () => {
			const condition = () => true;
			const onTimeout = vi.fn();
			const addWaiter = vi.fn();

			const promise = waitForCondition(condition, onTimeout, 1000, addWaiter);
			const result = await promise;

			expect(result).toBeUndefined();
			expect(addWaiter).not.toHaveBeenCalled();
			expect(onTimeout).not.toHaveBeenCalled();
		});

		it("should wait for condition to become true", async () => {
			let conditionMet = false;
			const condition = () => conditionMet;
			const onTimeout = vi.fn();
			const waiters: Array<() => void> = [];
			const addWaiter = (callback: () => void) => waiters.push(callback);

			const promise = waitForCondition(condition, onTimeout, 1000, addWaiter);

			// Condition starts false, so waiter should be added
			expect(waiters).toHaveLength(1);

			// Simulate condition becoming true
			conditionMet = true;
			waiters[0]();

			await promise;
			expect(onTimeout).not.toHaveBeenCalled();
		});

		it("should timeout if condition never becomes true", async () => {
			const condition = () => false;
			const onTimeout = vi.fn().mockResolvedValue(undefined);
			const addWaiter = vi.fn();

			const promise = waitForCondition(condition, onTimeout, 100, addWaiter);

			// Advance time to trigger timeout
			vi.advanceTimersByTime(100);

			await expect(promise).rejects.toThrow(TimeoutError);
			expect(onTimeout).toHaveBeenCalled();
		});
	});

	describe("withTimeout", () => {
		it("should resolve promise within timeout", async () => {
			const fastPromise = Promise.resolve("success");

			const result = await withTimeout(fastPromise, 1000);
			expect(result).toBe("success");
		});

		it("should timeout slow promises", async () => {
			const slowPromise = new Promise(resolve => {
				setTimeout(() => resolve("too late"), 2000);
			});

			const timeoutPromise = withTimeout(slowPromise, 1000);

			vi.advanceTimersByTime(1000);

			await expect(timeoutPromise).rejects.toThrow(TimeoutError);
		});

		it("should use custom timeout message", async () => {
			const slowPromise = new Promise(resolve => {
				setTimeout(() => resolve("too late"), 2000);
			});

			const timeoutPromise = withTimeout(slowPromise, 1000, "Custom timeout message");

			vi.advanceTimersByTime(1000);

			await expect(timeoutPromise).rejects.toThrow("Custom timeout message");
		});

		it("should propagate promise rejections", async () => {
			const failingPromise = Promise.reject(new Error("Operation failed"));

			await expect(withTimeout(failingPromise, 1000)).rejects.toThrow("Operation failed");
		});
	});

	describe("TimeoutError integration", () => {
		it("should export TimeoutError from p-timeout", () => {
			const error = new TimeoutError("Test timeout");
			expect(error).toBeInstanceOf(TimeoutError);
			expect(error.message).toBe("Test timeout");
			expect(error.name).toBe("TimeoutError");
		});
	});
});