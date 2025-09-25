/**
 * Simplified permission request manager using direct promise-per-request pattern
 * Eliminates complex batch coordination and race conditions
 */

import { randomUUID } from "node:crypto";
import {
	PermissionMalformedError,
	PermissionTimeoutError,
} from "../types/errors.js";
import type {
	PermissionOptions,
	PermissionRequest,
	PermissionResult,
} from "../types/permission.js";
import type { NavigatorCommand } from "../types.js";
import type { Logger } from "./logger.js";
import { TIMEOUT_CONFIG } from "./timeouts.js";

export interface NavigatorDecision {
	type: "approve" | "deny";
	comment?: string;
}

interface PendingRequest {
	resolve: (decision: NavigatorDecision) => void;
	reject: (error: Error) => void;
	timeoutId: NodeJS.Timeout;
	request: PermissionRequest;
	abortController?: AbortController;
}

export class PermissionRequestManager {
	private pendingRequests = new Map<string, PendingRequest>();

	constructor(
		private sendToNavigator: (
			request: PermissionRequest,
			requestId: string,
		) => Promise<void>,
		private logger: Logger,
	) {}

	/**
	 * Request permission with direct promise resolution
	 */
	async requestPermission(
		request: PermissionRequest,
		options: PermissionOptions = {},
		timeoutMs: number = TIMEOUT_CONFIG.PERMISSION_REQUEST,
	): Promise<PermissionResult> {
		const requestId = randomUUID();
		const { signal } = options;

		// Check if already aborted
		signal?.throwIfAborted();

		return new Promise<PermissionResult>((resolve, reject) => {
			// Set up timeout
			const timeoutId = setTimeout(() => {
				this.cleanupRequest(requestId);
				this.logger.logEvent("PERMISSION_TIMEOUT", {
					requestId,
					toolName: request.toolName,
					timeoutMs,
				});
				reject(
					new PermissionTimeoutError(
						`Navigator did not respond within ${timeoutMs}ms`,
					),
				);
			}, timeoutMs);

			// Set up abort signal handling
			const abortListener = () => {
				this.cleanupRequest(requestId);
				reject(new DOMException("Request was aborted", "AbortError"));
			};
			signal?.addEventListener("abort", abortListener);

			// Store request
			const pendingRequest: PendingRequest = {
				resolve: (decision) => {
					this.cleanupRequest(requestId);
					signal?.removeEventListener("abort", abortListener);
					try {
						const result = this.convertDecisionToResult(decision, request);
						this.logger.logEvent("PERMISSION_DECISION", {
							requestId,
							toolName: request.toolName,
							allowed: result.allowed,
						});
						resolve(result);
					} catch (error) {
						reject(error);
					}
				},
				reject: (error) => {
					this.cleanupRequest(requestId);
					signal?.removeEventListener("abort", abortListener);
					reject(error);
				},
				timeoutId,
				request,
			};

			this.pendingRequests.set(requestId, pendingRequest);

			// Send to navigator
			this.sendToNavigator(request, requestId).catch((error) => {
				this.cleanupRequest(requestId);
				signal?.removeEventListener("abort", abortListener);
				this.logger.logEvent("PERMISSION_SEND_ERROR", {
					requestId,
					toolName: request.toolName,
					error: error instanceof Error ? error.message : String(error),
				});
				reject(error);
			});
		});
	}

	/**
	 * Handle navigator decision response
	 */
	handleNavigatorDecision(
		requestId: string,
		commands: NavigatorCommand[],
	): void {
		const pending = this.pendingRequests.get(requestId);
		if (!pending) {
			this.logger.logEvent("PERMISSION_ORPHANED_RESPONSE", {
				requestId,
				commandCount: commands.length,
			});
			return;
		}

		try {
			const decision = this.extractDecisionFromCommands(commands);
			if (decision.type === "approve" || decision.type === "deny") {
				pending.resolve(decision);
			} else {
				pending.reject(
					new PermissionMalformedError(
						"Navigator provided invalid decision - no approve or deny command found",
					),
				);
			}
		} catch (error) {
			pending.reject(
				error instanceof Error
					? error
					: new Error(`Failed to process navigator decision: ${String(error)}`),
			);
		}
	}

	/**
	 * Handle navigator error for a specific request
	 */
	handleNavigatorError(requestId: string, error: Error): void {
		const pending = this.pendingRequests.get(requestId);
		if (pending) {
			pending.reject(error);
		}
	}

	/**
	 * Get count of pending requests (for testing/monitoring)
	 */
	getPendingRequestCount(): number {
		return this.pendingRequests.size;
	}

	/**
	 * Cancel all pending requests (cleanup)
	 */
	cancelAllRequests(reason: string = "System shutdown"): void {
		for (const [_requestId, pending] of this.pendingRequests.entries()) {
			pending.reject(new Error(reason));
		}
		this.pendingRequests.clear();
	}

	private cleanupRequest(requestId: string): void {
		const pending = this.pendingRequests.get(requestId);
		if (pending) {
			clearTimeout(pending.timeoutId);
			this.pendingRequests.delete(requestId);
		}
	}

	private extractDecisionFromCommands(
		commands: NavigatorCommand[],
	): NavigatorDecision {
		for (const cmd of commands) {
			if (cmd.type === "approve") {
				return { type: "approve", comment: cmd.comment };
			}
			if (cmd.type === "deny") {
				return { type: "deny", comment: cmd.comment };
			}
		}
		return { type: "none" as any }; // Will trigger malformed error
	}

	private convertDecisionToResult(
		decision: NavigatorDecision,
		request: PermissionRequest,
	): PermissionResult {
		if (decision.type === "approve") {
			return {
				allowed: true,
				updatedInput: request.input,
				comment: decision.comment,
			};
		}

		if (decision.type === "deny") {
			return {
				allowed: false,
				reason: decision.comment || "Navigator denied permission",
			};
		}

		throw new PermissionMalformedError(
			"Navigator provided invalid decision type",
		);
	}
}
