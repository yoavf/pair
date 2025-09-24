/**
 * Navigator permission handling logic
 */

import {
	NavigatorSessionError,
	PermissionDeniedError,
	PermissionMalformedError,
} from "../../types/errors.js";
import type {
	PermissionOptions,
	PermissionRequest,
	PermissionResult,
} from "../../types/permission.js";
import type { NavigatorCommand } from "../../types.js";
import type { PermissionDecisionType } from "./prompts.js";

export class NavigatorPermissionHandler {
	private inPermissionApproval = false;
	private permissionDecisionShown = false;

	constructor(
		private waitForPermissionDecision: () => Promise<{
			commands: NavigatorCommand[];
		}>,
		private ensureStreamingQuery: () => Promise<void>,
		private waitForNoPendingTools: () => Promise<void>,
		private sendText: (text: string) => void,
		private sessionId: string | null,
		private plan?: string,
		private originalTask?: string,
	) {}

	/**
	 * Review a permission request from the driver
	 */
	async reviewPermission(
		request: PermissionRequest,
		options: PermissionOptions = {},
	): Promise<PermissionResult> {
		const { signal } = options;

		signal?.throwIfAborted();

		const toolDetails = `Tool: ${request.toolName}\nInput: ${JSON.stringify(request.input, null, 2)}`;
		const strictCore = `CRITICAL: This is a PERMISSION REQUEST. You MUST respond with EXACTLY ONE of these MCP tool calls:
- mcp__navigator__navigatorApprove (if you approve this specific edit)
- mcp__navigator__navigatorDeny (if you reject this specific edit)

DO NOT call mcp__navigator__navigatorComplete or mcp__navigator__navigatorCodeReview for permission requests.`;

		const header =
			!this.sessionId && this.plan && this.originalTask
				? `[CONTEXT] You are the navigator in our pair coding session. I'm implementing the plan.\nTask: ${this.originalTask}\nPlan:\n${this.plan}\n\nWhen I ask for permission to edit files, respond only with MCP decision tools as instructed below. Do not write prose.\n\n[PERMISSION REQUEST]\nMy actions transcript (since last approval):\n${request.driverTranscript}\n\n${toolDetails}\n\n${strictCore}`
				: `[PERMISSION REQUEST]\nMy actions transcript (since last approval):\n${request.driverTranscript}\n\n${toolDetails}\n\n${strictCore}`;

		this.inPermissionApproval = true;
		this.permissionDecisionShown = false;

		try {
			await this.ensureStreamingQuery();
			await this.waitForNoPendingTools();

			signal?.throwIfAborted();

			this.sendText(header);

			const result = await this.waitForPermissionDecision();

			signal?.throwIfAborted();

			const decision = this.extractPermissionDecision(result.commands);

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

			throw new PermissionMalformedError("Navigator provided invalid decision");
		} catch (err) {
			if (
				err instanceof PermissionDeniedError ||
				err instanceof PermissionMalformedError
			) {
				throw err;
			}
			throw new NavigatorSessionError(
				err instanceof Error ? err.message : String(err),
			);
		} finally {
			this.inPermissionApproval = false;
			this.permissionDecisionShown = false;
		}
	}

	/**
	 * Extract permission decision from navigator commands
	 */
	extractPermissionDecision(commands: NavigatorCommand[]): {
		type: PermissionDecisionType;
		comment?: string;
	} {
		for (const cmd of commands) {
			if (cmd.type === "approve") {
				return { type: "approve", comment: cmd.comment };
			}
			if (cmd.type === "deny") {
				return { type: "deny", comment: cmd.comment };
			}
		}
		return { type: "none" };
	}

	get isInPermissionApproval(): boolean {
		return this.inPermissionApproval;
	}

	get isPermissionDecisionShown(): boolean {
		return this.permissionDecisionShown;
	}

	setPermissionDecisionShown(shown: boolean): void {
		this.permissionDecisionShown = shown;
	}
}
