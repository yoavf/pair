/**
 * Tool tracking system for synchronizing tool calls with review results
 */

import type { Role } from "../types.js";

export interface TrackedTool {
	id: string;
	toolName: string;
	input: any;
	role: Role;
	timestamp: Date;
	status: "pending" | "approved" | "denied" | "displayed";
	reviewComment?: string;
	providerCallId?: string;
	permissionRequestId?: string;
}

export interface ToolReviewResult {
	toolId: string;
	approved: boolean;
	comment?: string;
}

/**
 * Tracks tool calls and their review results to ensure synchronized display
 */
export class ToolTracker {
	private tools = new Map<string, TrackedTool>();
	private pendingReviews = new Map<string, TrackedTool>();
	private reviewCallbacks = new Map<
		string,
		(result: ToolReviewResult) => void
	>();
	private toolCounter = 0;
	private callIdToToolId = new Map<string, string>();
	private permissionRequestIdToToolId = new Map<string, string>();
	private readonly REVIEW_TIMEOUT_MS = 2000;

	/**
	 * Generate a unique tool ID
	 */
	generateToolId(): string {
		this.toolCounter++;
		return `TOOL_${String(this.toolCounter).padStart(3, "0")}`;
	}

	/**
	 * Register a tool call that needs review
	 */
	registerTool(toolName: string, input: any, role: Role): string {
		const id = this.generateToolId();
		const tool: TrackedTool = {
			id,
			toolName,
			input,
			role,
			timestamp: new Date(),
			status: "pending",
		};

		this.tools.set(id, tool);

		// Only track for review if it's a file modification tool from driver
		if (role === "driver" && this.isReviewableTool(toolName)) {
			this.pendingReviews.set(id, tool);
		}

		return id;
	}

	associateCallId(toolId: string, callId: string): void {
		const tool = this.tools.get(toolId);
		if (!tool) return;
		tool.providerCallId = callId;
		this.callIdToToolId.set(callId, toolId);
	}

	getToolIdByCallId(callId: string): string | undefined {
		return this.callIdToToolId.get(callId);
	}

	/**
	 * Associate a permission request ID with a tool
	 */
	associatePermissionRequest(
		toolId: string,
		permissionRequestId: string,
	): void {
		const tool = this.tools.get(toolId);
		if (!tool) return;
		tool.permissionRequestId = permissionRequestId;
		this.permissionRequestIdToToolId.set(permissionRequestId, toolId);
	}

	/**
	 * Get tool ID by permission request ID
	 */
	getToolIdByPermissionRequestId(
		permissionRequestId: string,
	): string | undefined {
		return this.permissionRequestIdToToolId.get(permissionRequestId);
	}

	/**
	 * Check if a tool requires review
	 */
	isReviewableTool(toolName: string): boolean {
		const reviewableTools = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
		return reviewableTools.includes(toolName);
	}

	/**
	 * Record a review result for a tool
	 */
	recordReview(toolId: string, approved: boolean, comment?: string): void {
		const tool = this.tools.get(toolId);
		if (!tool) return;

		tool.status = approved ? "approved" : "denied";
		tool.reviewComment = comment;
		this.pendingReviews.delete(toolId);

		// Trigger any waiting callback
		const callback = this.reviewCallbacks.get(toolId);
		if (callback) {
			callback({ toolId, approved, comment });
			this.reviewCallbacks.delete(toolId);
		}
	}

	/**
	 * Wait for a review result with timeout
	 */
	async waitForReview(toolId: string): Promise<ToolReviewResult | null> {
		const tool = this.tools.get(toolId);
		if (!tool) return null;

		// If already reviewed, return immediately
		if (tool.status !== "pending") {
			return {
				toolId,
				approved: tool.status === "approved",
				comment: tool.reviewComment,
			};
		}

		// Wait for review with timeout
		return new Promise((resolve) => {
			const timeoutId = setTimeout(() => {
				this.reviewCallbacks.delete(toolId);
				resolve(null); // Timeout - display without review
			}, this.REVIEW_TIMEOUT_MS);

			this.reviewCallbacks.set(toolId, (result) => {
				clearTimeout(timeoutId);
				resolve(result);
			});
		});
	}

	/**
	 * Get pending tools awaiting review
	 */
	getPendingTools(): TrackedTool[] {
		return Array.from(this.pendingReviews.values());
	}

	/**
	 * Mark a tool as displayed
	 */
	markDisplayed(toolId: string): void {
		const tool = this.tools.get(toolId);
		if (tool) {
			tool.status = "displayed";
		}
	}

	/**
	 * Clear old tools to prevent memory leaks
	 */
	clearOldTools(maxAgeMs = 300000): void {
		// 5 minutes default
		const now = Date.now();
		for (const [id, tool] of this.tools) {
			if (now - tool.timestamp.getTime() > maxAgeMs) {
				this.tools.delete(id);
				this.pendingReviews.delete(id);
				this.reviewCallbacks.delete(id);
				if (tool.providerCallId) {
					this.callIdToToolId.delete(tool.providerCallId);
				}
				if (tool.permissionRequestId) {
					this.permissionRequestIdToToolId.delete(tool.permissionRequestId);
				}
			}
		}
	}

	/**
	 * Get tool by ID
	 */
	getTool(toolId: string): TrackedTool | undefined {
		return this.tools.get(toolId);
	}

	/**
	 * Reset the tracker (for testing)
	 */
	reset(): void {
		this.tools.clear();
		this.pendingReviews.clear();
		this.reviewCallbacks.clear();
		this.callIdToToolId.clear();
		this.permissionRequestIdToToolId.clear();
		this.toolCounter = 0;
	}
}

// Singleton instance for the application
export const toolTracker = new ToolTracker();
