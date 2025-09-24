/**
 * Permission handling utilities for driver-navigator coordination
 */

import type { Navigator } from "../conversations/Navigator.js";
import type { InkDisplayManager } from "../display.js";
import {
	NavigatorSessionError,
	PermissionDeniedError,
	PermissionMalformedError,
	PermissionTimeoutError,
} from "../types/errors.js";
import type { PermissionRequest } from "../types/permission.js";
import type { Logger } from "./logger.js";
import { TIMEOUT_CONFIG, TimeoutManager } from "./timeouts.js";

export class PermissionHandler {
	constructor(
		private navigator: Navigator,
		private display: InkDisplayManager,
		private logger: Logger,
	) {}

	async requestPermissionWithTimeout(
		request: PermissionRequest,
		timeoutMs = TIMEOUT_CONFIG.PERMISSION_REQUEST,
	) {
		const { controller, cleanup } = TimeoutManager.createTimeout(timeoutMs);

		try {
			const result = await this.navigator.reviewPermission(request, {
				signal: controller.signal,
			});
			cleanup();
			return result;
		} catch (error) {
			cleanup();

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

	createCanUseToolHandler(getDriverTranscript: () => string) {
		return async (
			toolName: string,
			input: Record<string, unknown>,
			_options?: { suggestions?: Record<string, unknown> },
		): Promise<
			| {
					behavior: "allow";
					updatedInput: Record<string, unknown>;
					updatedPermissions?: Record<string, unknown>;
			  }
			| { behavior: "deny"; message: string }
		> => {
			const { isFileModificationTool } = await import("../types/core.js");
			const needsApproval = isFileModificationTool(toolName);

			if (!needsApproval) {
				return { behavior: "allow", updatedInput: input };
			}

			// Get driver transcript
			const transcript = getDriverTranscript();

			// Display transfer to navigator for permission
			this.display?.showTransfer("driver", "navigator", "Permission request");
			this.display?.updateStatus(`Awaiting navigator approval: ${toolName}`);
			this.logger.logEvent("PERMISSION_REQUEST_SENT", {
				toolName,
				inputKeys: Object.keys(input || {}),
				transcriptPreview: transcript.slice(0, 200),
			});

			const result = await this.requestPermissionWithTimeout({
				driverTranscript: transcript,
				toolName,
				input,
			});

			this.display?.showTransfer("navigator", "driver", "Decision");
			this.display?.updateStatus(
				result.allowed ? `Approved: ${toolName}` : `Denied: ${toolName}`,
			);
			this.logger.logEvent("PERMISSION_DECISION", {
				toolName,
				allowed: result.allowed,
			});

			if (!result.allowed) {
				return {
					behavior: "deny",
					message: result.reason,
				};
			}

			return {
				behavior: "allow",
				updatedInput: result.updatedInput,
			};
		};
	}
}
