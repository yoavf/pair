/**
 * Tool management utilities for Driver
 */

import {
	normalizeMcpTool,
	extractResultContent as sharedExtractResultContent,
	generateMessageId as sharedGenerateMessageId,
	isApprovedEditTool as sharedIsApprovedEditTool,
} from "../shared/toolUtils.js";

/**
 * Generate a short, human-friendly message ID
 */
export const generateMessageId = sharedGenerateMessageId;

/**
 * Normalize driver tool names
 */
export function normalizeDriverTool(toolName: string): string {
	return normalizeMcpTool(toolName, "driver");
}

/**
 * Check if a tool is an approved edit tool (that should be filtered from navigator messages)
 */
export const isApprovedEditTool = sharedIsApprovedEditTool;

/**
 * Extract content from a tool result item
 * @param item - The tool result item from Claude Code SDK
 */
export const extractResultContent = sharedExtractResultContent;
