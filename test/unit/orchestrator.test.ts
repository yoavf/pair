/**
 * Tests for orchestrator-level permission handling logic
 * Focuses on timeout/retry behavior and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	PermissionTimeoutError,
	PermissionDeniedError,
	PermissionMalformedError,
	NavigatorSessionError,
} from "../../src/types/errors.js";
import type { PermissionRequest } from "../../src/types/permission.js";

// Mock Navigator class
class MockNavigator {
	reviewPermission = vi.fn();
}

// Mock Logger
class MockLogger {
	logEvent = vi.fn();
	getFilePath = vi.fn().mockReturnValue("/tmp/test.log");
	close = vi.fn();
}

// Mock Display
class MockDisplay {
	showTransfer = vi.fn();
	updateStatus = vi.fn();
}

/**
 * Simplified orchestrator class that extracts just the permission logic
 * This allows us to test the timeout/retry behavior in isolation
 */
class PermissionOrchestrator {
	constructor(
		private navigator: MockNavigator,
		private logger: MockLogger,
		private display: MockDisplay
	) {}

	async requestPermissionWithTimeout(
		request: PermissionRequest,
		timeoutMs = 15000,
	) {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => {
			controller.abort();
		}, timeoutMs);

		try {
			const result = await this.navigator.reviewPermission(request, {
				signal: controller.signal,
			});
			clearTimeout(timeoutId);
			return result;
		} catch (error) {
			clearTimeout(timeoutId);

			if (error instanceof PermissionDeniedError) {
				return {
					allowed: false as const,
					reason: error.reason,
				};
			}

			if (error instanceof PermissionTimeoutError) {
				this.logger.logEvent("PERMISSION_TIMEOUT", {
					toolName: request.toolName,
					timeoutMs,
				});
				return {
					allowed: false as const,
					reason: "Permission request timed out",
				};
			}

			if (error instanceof PermissionMalformedError) {
				this.logger.logEvent("PERMISSION_MALFORMED", {
					toolName: request.toolName,
					error: error.message,
				});
				return {
					allowed: false as const,
					reason: "Navigator provided invalid response",
				};
			}

			if (error instanceof NavigatorSessionError) {
				this.logger.logEvent("PERMISSION_SESSION_ERROR", {
					toolName: request.toolName,
					error: error.message,
				});
				return {
					allowed: false as const,
					reason: "Navigator session error",
				};
			}

			if (controller.signal.aborted) {
				this.logger.logEvent("PERMISSION_ABORTED", {
					toolName: request.toolName,
				});
				return {
					allowed: false as const,
					reason: "Permission request was cancelled",
				};
			}

			this.logger.logEvent("PERMISSION_UNKNOWN_ERROR", {
				toolName: request.toolName,
				error: error instanceof Error ? error.message : String(error),
			});
			return {
				allowed: false as const,
				reason: "Unknown error occurred",
			};
		}
	}
}

describe("Permission Orchestrator", () => {
	let mockNavigator: MockNavigator;
	let mockLogger: MockLogger;
	let mockDisplay: MockDisplay;
	let orchestrator: PermissionOrchestrator;

	beforeEach(() => {
		mockNavigator = new MockNavigator();
		mockLogger = new MockLogger();
		mockDisplay = new MockDisplay();
		orchestrator = new PermissionOrchestrator(mockNavigator, mockLogger, mockDisplay);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	const createTestRequest = (toolName = "Edit"): PermissionRequest => ({
		driverTranscript: "I want to modify the authentication logic",
		toolName,
		input: { file_path: "src/auth.ts", old_string: "old", new_string: "new" },
	});

	describe("Timeout Handling", () => {
		it("should handle AbortController timeout behavior", async () => {
			let abortCalled = false;
			mockNavigator.reviewPermission.mockImplementation((request, options) => {
				return new Promise((resolve, reject) => {
					options?.signal?.addEventListener('abort', () => {
						abortCalled = true;
						reject(new DOMException('AbortError', 'AbortError'));
					});
					// Don't resolve - will be aborted
				});
			});

			const request = createTestRequest();
			const result = await orchestrator.requestPermissionWithTimeout(request, 1); // 1ms timeout

			expect(abortCalled).toBe(true);
			expect(result.allowed).toBe(false);
			expect(result.reason).toBe("Permission request was cancelled");
		});

		it("should accept different timeout values", async () => {
			// Test that different timeout values are passed correctly
			const shortResult = { allowed: true as const, updatedInput: {} };
			const longResult = { allowed: false as const, reason: "Denied" };

			mockNavigator.reviewPermission
				.mockResolvedValueOnce(shortResult)
				.mockResolvedValueOnce(longResult);

			const result1 = await orchestrator.requestPermissionWithTimeout(createTestRequest("Edit"), 100);
			const result2 = await orchestrator.requestPermissionWithTimeout(createTestRequest("Write"), 5000);

			expect(result1).toBe(shortResult);
			expect(result2).toBe(longResult);
		});

		it("should clear timeout when permission resolves successfully", async () => {
			const mockResult = {
				allowed: true as const,
				updatedInput: { file_path: "test.ts" },
				comment: "Approved",
			};

			mockNavigator.reviewPermission.mockResolvedValue(mockResult);

			const request = createTestRequest();
			const result = await orchestrator.requestPermissionWithTimeout(request, 5000);

			expect(result).toBe(mockResult);
			expect(mockLogger.logEvent).not.toHaveBeenCalled();
		});
	});

	describe("Error Type Handling", () => {
		it("should handle PermissionDeniedError correctly", async () => {
			const deniedError = new PermissionDeniedError("Code needs more testing");
			mockNavigator.reviewPermission.mockRejectedValue(deniedError);

			const request = createTestRequest();
			const result = await orchestrator.requestPermissionWithTimeout(request);

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe("Code needs more testing");
			expect(mockLogger.logEvent).not.toHaveBeenCalled(); // No error logging for business logic
		});

		it("should handle PermissionTimeoutError correctly", async () => {
			const timeoutError = new PermissionTimeoutError("Navigator timed out");
			mockNavigator.reviewPermission.mockRejectedValue(timeoutError);

			const request = createTestRequest();
			const result = await orchestrator.requestPermissionWithTimeout(request);

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe("Permission request timed out");
			expect(mockLogger.logEvent).toHaveBeenCalledWith("PERMISSION_TIMEOUT", {
				toolName: "Edit",
				timeoutMs: 15000,
			});
		});

		it("should handle PermissionMalformedError correctly", async () => {
			const malformedError = new PermissionMalformedError("Invalid MCP response");
			mockNavigator.reviewPermission.mockRejectedValue(malformedError);

			const request = createTestRequest();
			const result = await orchestrator.requestPermissionWithTimeout(request);

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe("Navigator provided invalid response");
			expect(mockLogger.logEvent).toHaveBeenCalledWith("PERMISSION_MALFORMED", {
				toolName: "Edit",
				error: "Invalid MCP response",
			});
		});

		it("should handle NavigatorSessionError correctly", async () => {
			const sessionError = new NavigatorSessionError("Connection lost");
			mockNavigator.reviewPermission.mockRejectedValue(sessionError);

			const request = createTestRequest();
			const result = await orchestrator.requestPermissionWithTimeout(request);

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe("Navigator session error");
			expect(mockLogger.logEvent).toHaveBeenCalledWith("PERMISSION_SESSION_ERROR", {
				toolName: "Edit",
				error: "Connection lost",
			});
		});

		it("should handle unknown errors gracefully", async () => {
			const unknownError = new Error("Something unexpected");
			mockNavigator.reviewPermission.mockRejectedValue(unknownError);

			const request = createTestRequest();
			const result = await orchestrator.requestPermissionWithTimeout(request);

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe("Unknown error occurred");
			expect(mockLogger.logEvent).toHaveBeenCalledWith("PERMISSION_UNKNOWN_ERROR", {
				toolName: "Edit",
				error: "Something unexpected",
			});
		});

		it("should handle non-Error objects", async () => {
			mockNavigator.reviewPermission.mockRejectedValue("string error");

			const request = createTestRequest();
			const result = await orchestrator.requestPermissionWithTimeout(request);

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe("Unknown error occurred");
			expect(mockLogger.logEvent).toHaveBeenCalledWith("PERMISSION_UNKNOWN_ERROR", {
				toolName: "Edit",
				error: "string error",
			});
		});
	});

	describe("AbortController Integration", () => {
		it("should properly abort requests", async () => {
			let abortSignal: AbortSignal | undefined;

			mockNavigator.reviewPermission.mockImplementation((request, options) => {
				abortSignal = options?.signal;
				return new Promise((resolve, reject) => {
					abortSignal?.addEventListener('abort', () => {
						reject(new DOMException('AbortError', 'AbortError'));
					});
				});
			});

			const request = createTestRequest();
			const timeoutMs = 1;

			const result = await orchestrator.requestPermissionWithTimeout(request, timeoutMs);

			expect(abortSignal?.aborted).toBe(true);
			expect(result.allowed).toBe(false);
			expect(result.reason).toBe("Permission request was cancelled");
		});

		it("should pass AbortSignal to navigator", async () => {
			let receivedSignal: AbortSignal | undefined;

			mockNavigator.reviewPermission.mockImplementation((request, options) => {
				receivedSignal = options?.signal;
				return Promise.resolve({
					allowed: true as const,
					updatedInput: request.input,
				});
			});

			const request = createTestRequest();
			await orchestrator.requestPermissionWithTimeout(request);

			expect(receivedSignal).toBeInstanceOf(AbortSignal);
			expect(receivedSignal?.aborted).toBe(false);
		});
	});

	describe("Performance and Resource Management", () => {
		it("should clear timeouts even when errors occur", async () => {
			const error = new PermissionMalformedError("Test error");
			mockNavigator.reviewPermission.mockRejectedValue(error);

			const spy = vi.spyOn(global, 'clearTimeout');

			const request = createTestRequest();
			await orchestrator.requestPermissionWithTimeout(request);

			expect(spy).toHaveBeenCalled();
		});

		it("should handle multiple concurrent permission requests", async () => {
			// Mock immediate responses
			mockNavigator.reviewPermission
				.mockResolvedValueOnce({
					allowed: true as const,
					updatedInput: {},
				})
				.mockResolvedValueOnce({
					allowed: false as const,
					reason: "Denied",
				});

			const request1 = createTestRequest("Edit");
			const request2 = createTestRequest("Write");

			const [result1, result2] = await Promise.all([
				orchestrator.requestPermissionWithTimeout(request1),
				orchestrator.requestPermissionWithTimeout(request2),
			]);

			expect(result1.allowed).toBe(true);
			expect(result2.allowed).toBe(false);
		});
	});

	describe("Edge Cases", () => {
		it("should handle zero timeout", async () => {
			mockNavigator.reviewPermission.mockImplementation((request, options) => {
				return new Promise((resolve, reject) => {
					options?.signal?.addEventListener('abort', () => {
						reject(new DOMException('AbortError', 'AbortError'));
					});
				});
			});

			const request = createTestRequest();
			const result = await orchestrator.requestPermissionWithTimeout(request, 0);

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe("Permission request was cancelled");
		});

		it("should handle very large timeout values", async () => {
			const mockResult = {
				allowed: true as const,
				updatedInput: {},
			};
			mockNavigator.reviewPermission.mockResolvedValue(mockResult);

			const request = createTestRequest();
			const result = await orchestrator.requestPermissionWithTimeout(request, 999999999);

			expect(result).toBe(mockResult);
		});
	});
});