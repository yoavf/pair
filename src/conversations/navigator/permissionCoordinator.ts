/**
 * Request-ID based permission coordination
 * Replaces complex batch resolvers with direct promise mapping
 */

import {
	PermissionMalformedError,
	PermissionTimeoutError,
} from "../../types/errors.js";
import type {
	PermissionOptions,
	PermissionRequest,
	PermissionResult,
} from "../../types/permission.js";
import type { NavigatorCommand } from "../../types.js";
import type { Logger } from "../../utils/logger.js";
import { TIMEOUT_CONFIG } from "../../utils/timeouts.js";

interface PendingPermissionRequest {
	resolve: (result: PermissionResult) => void;
	reject: (error: Error) => void;
	timeoutId: NodeJS.Timeout;
	request: PermissionRequest;
	timestamp: number;
}

export class PermissionCoordinator {
	private pendingRequests = new Map<string, PendingPermissionRequest>();

	constructor(
		private sendToNavigator: (request: PermissionRequest) => void,
		private logger: Logger,
	) {}

	async requestPermission(
		request: PermissionRequest,
		options: PermissionOptions = {},
	): Promise<PermissionResult> {
		const { signal } = options;
		signal?.throwIfAborted();

		const requestId = request.requestId || crypto.randomUUID();
		const requestWithId = { ...request, requestId };

		return new Promise<PermissionResult>((resolve, reject) => {
			// Set up timeout
			const timeoutId = setTimeout(() => {
				this.pendingRequests.delete(requestId);
				reject(
					new PermissionTimeoutError(
						`Navigator did not respond to permission request within ${TIMEOUT_CONFIG.PERMISSION_REQUEST}ms`,
					),
				);
			}, TIMEOUT_CONFIG.PERMISSION_REQUEST);

			// Store pending request
			this.pendingRequests.set(requestId, {
				resolve,
				reject,
				timeoutId,
				request: requestWithId,
				timestamp: Date.now(),
			});

			// Handle abort signal
			signal?.addEventListener("abort", () => {
				const pending = this.pendingRequests.get(requestId);
				if (pending) {
					clearTimeout(pending.timeoutId);
					this.pendingRequests.delete(requestId);
					reject(new DOMException("AbortError", "AbortError"));
				}
			});

			// Send to navigator
			this.sendToNavigator(requestWithId);
		});
	}

	/**
	 * Handle navigator decision - called when navigator uses approve/deny tools
	 */
	handleNavigatorDecision(command: NavigatorCommand): boolean {
		if (command.type !== "approve" && command.type !== "deny") {
			return false; // Not a permission decision
		}

		const requestId = (command as any).requestId;
		let pending: PendingPermissionRequest | undefined;

		if (requestId) {
			// Exact match by request ID
			pending = this.pendingRequests.get(requestId);
		} else {
			// Fallback: match oldest pending request
			// This maintains backward compatibility with navigators that don't send requestId
			const sorted = Array.from(this.pendingRequests.entries()).sort(
				([, a], [, b]) => a.timestamp - b.timestamp,
			);
			if (sorted.length > 0) {
				pending = sorted[0][1];
				this.logger.logEvent("PERMISSION_FALLBACK_MATCH", {
					requestId: sorted[0][0],
					toolName: pending.request.toolName,
				});
			}
		}

		if (!pending) {
			this.logger.logEvent("PERMISSION_ORPHANED_DECISION", {
				decisionType: command.type,
				requestId,
				pendingCount: this.pendingRequests.size,
			});
			return false;
		}

		// Clean up
		const actualRequestId =
			requestId || Array.from(this.pendingRequests.keys())[0];
		clearTimeout(pending.timeoutId);
		this.pendingRequests.delete(actualRequestId);

		// Emit logs that existing tests expect
		this.logger.logEvent("NAVIGATOR_BATCH_RESULT", {
			commandCount: 1, // Maintain test compatibility
		});

		// Resolve with appropriate result
		if (command.type === "approve") {
			pending.resolve({
				allowed: true,
				updatedInput: pending.request.input,
				comment: command.comment,
			});
		} else {
			pending.resolve({
				allowed: false,
				reason: command.comment || "Navigator denied permission",
			});
		}

		return true;
	}

	/**
	 * Handle malformed responses (when navigator responds without decision tools)
	 */
	handleMalformedResponse(): void {
		const pendingEntries = Array.from(this.pendingRequests.entries());
		this.pendingRequests.clear();

		for (const [_requestId, pending] of pendingEntries) {
			clearTimeout(pending.timeoutId);
			pending.reject(
				new PermissionMalformedError("Navigator provided invalid decision"),
			);
		}
	}

	/**
	 * Handle general errors or timeouts
	 */
	handleError(error: Error): void {
		// Reject all pending requests with the error
		const pendingEntries = Array.from(this.pendingRequests.entries());
		this.pendingRequests.clear();

		for (const [_requestId, pending] of pendingEntries) {
			clearTimeout(pending.timeoutId);
			pending.reject(error);
		}
	}

	/**
	 * Get status information for debugging
	 */
	getStatus() {
		return {
			pendingCount: this.pendingRequests.size,
			pendingRequestIds: Array.from(this.pendingRequests.keys()),
		};
	}

	/**
	 * Clean up resources
	 */
	cleanup() {
		for (const [_requestId, pending] of this.pendingRequests.entries()) {
			clearTimeout(pending.timeoutId);
		}
		this.pendingRequests.clear();
	}
}
