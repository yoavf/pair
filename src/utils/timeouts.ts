/**
 * Shared timeout utilities and configuration
 */

// Configurable timeout values (in milliseconds)
export const TIMEOUT_CONFIG = {
	TOOL_COMPLETION: Number(process.env.PAIR_TOOL_TIMEOUT_MS) || 120000, // 2 minutes
	PERMISSION_REQUEST: Number(process.env.PAIR_PERMISSION_TIMEOUT_MS) || 15000, // 15 seconds
} as const;

/**
 * Generic timeout utility with AbortController integration
 */
export class TimeoutManager {
	/**
	 * Create a timeout with AbortController for cancellable operations
	 */
	static createTimeout(timeoutMs: number): {
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
	 * Create a waiter-based timeout for pending operations
	 */
	static createWaiterTimeout(
		condition: () => boolean,
		onTimeout: () => Promise<void> | void,
		timeoutMs: number,
		addWaiter: (callback: () => void) => void,
	): Promise<void> {
		if (condition()) return Promise.resolve();

		return new Promise((resolve, reject) => {
			const timer = setTimeout(async () => {
				try {
					await onTimeout();
					reject(new Error(`Operation timed out after ${timeoutMs}ms`));
				} catch (error) {
					reject(error);
				}
			}, timeoutMs);

			const onResolve = () => {
				clearTimeout(timer);
				resolve();
			};
			addWaiter(onResolve);
		});
	}
}
