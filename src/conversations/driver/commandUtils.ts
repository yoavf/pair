/**
 * Driver command utilities
 */

import type { DriverCommand } from "../../types.js";
import { normalizeDriverTool } from "./toolUtils.js";

/**
 * Convert MCP tool call to DriverCommand
 */
export function convertMcpToolToDriverCommand(
	toolName: string,
	input: any,
): DriverCommand | null {
	const normalized = normalizeDriverTool(toolName);
	switch (normalized) {
		case "mcp__driver__driverRequestReview":
			return {
				type: "request_review",
				context: input.context,
			};
		case "mcp__driver__driverRequestGuidance":
			return {
				type: "request_guidance",
				context: input.context,
			};
		default:
			return null;
	}
}

/**
 * Check if messages contain a RequestReview command (legacy, now handled via MCP tools)
 * This method is kept for backward compatibility
 */
export function hasRequestReview(_messages: string[]): DriverCommand | null {
	// This will be replaced by MCP tool event detection in the orchestration layer
	// For now, return null since MCP tools handle this communication
	return null;
}
