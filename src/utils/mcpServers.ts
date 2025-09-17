/**
 * MCP Server Configurations for Pair Programming Communication
 *
 * Creates MCP servers for Navigator and Driver agents using the Claude Code SDK.
 */

import { createSdkMcpServer } from "@anthropic-ai/claude-code";
import {
	driverRequestGuidance,
	driverRequestReview,
	navigatorApprove,
	navigatorCodeReview,
	navigatorComplete,
	navigatorDeny,
} from "./mcpTools.js";

/**
 * MCP server for Navigator communication tools
 * Provides tools for code review, approval/denial, and completion
 */
export const navigatorMcpServer = createSdkMcpServer({
	name: "navigator",
	version: "1.0.0",
	tools: [
		navigatorCodeReview,
		navigatorComplete,
		navigatorApprove,
		navigatorDeny,
	],
});

/**
 * MCP server for Driver communication tools
 * Provides tools for requesting review
 */
export const driverMcpServer = createSdkMcpServer({
	name: "driver",
	version: "1.0.0",
	tools: [driverRequestReview, driverRequestGuidance],
});

/**
 * Tool names for Navigator (for allowedTools configuration)
 */
export const NAVIGATOR_TOOL_NAMES = [
	"mcp__navigator__navigatorCodeReview",
	"mcp__navigator__navigatorComplete",
	"mcp__navigator__navigatorApprove",
	"mcp__navigator__navigatorDeny",
] as const;

/**
 * Tool names for Driver (for allowedTools configuration)
 */
export const DRIVER_TOOL_NAMES = [
	"mcp__driver__driverRequestReview",
	"mcp__driver__driverRequestGuidance",
] as const;
