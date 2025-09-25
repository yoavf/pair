/**
 * Timeout utilities using p-timeout for clean async timeout handling
 */

import pTimeout, { TimeoutError } from "p-timeout";

// Configurable timeout values (in milliseconds)
export const TIMEOUT_CONFIG = {
	TOOL_COMPLETION: Number(process.env.PAIR_TOOL_TIMEOUT_MS) || 120000, // 2 minutes
	PERMISSION_REQUEST: Number(process.env.PAIR_PERMISSION_TIMEOUT_MS) || 45000, // 45 seconds
} as const;

/**
 * Create a timeout with AbortController for cancellable operations
 */
export function createTimeout(timeoutMs: number): {
	controller: AbortController;
	cleanup: () => void;
} {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => {
		controller.abort();
	}, timeoutMs);

	return {
		controller,
		cleanup: () => clearTimeout(timeoutId),
	};
}

/**
 * Create a promise that resolves when a condition becomes true, with timeout
 */
export function waitForCondition(
	condition: () => boolean,
	onTimeout: () => Promise<void> | void,
	timeoutMs: number,
	addWaiter: (callback: () => void) => void,
): Promise<void> {
	if (condition()) return Promise.resolve();

	const waitPromise = new Promise<void>((resolve) => {
		const checkCondition = () => {
			if (condition()) {
				resolve();
			}
		};
		addWaiter(checkCondition);
	});

	return pTimeout(waitPromise, {
		milliseconds: timeoutMs,
		message: `Operation timed out after ${timeoutMs}ms`,
		fallback: async () => {
			await onTimeout();
			throw new TimeoutError(`Operation timed out after ${timeoutMs}ms`);
		},
	});
}

/**
 * Add timeout to any promise using p-timeout
 */
export function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	timeoutMessage?: string,
): Promise<T> {
	return pTimeout(promise, {
		milliseconds: timeoutMs,
		message: timeoutMessage || `Operation timed out after ${timeoutMs}ms`,
	});
}

// Re-export TimeoutError for convenience
export { TimeoutError };
