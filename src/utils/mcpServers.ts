/**
 * MCP Server Configurations for Pair Programming Communication
 *
 * Creates MCP servers for Navigator and Driver agents using the Claude Agent SDK.
 */

import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import {
	driverRequestGuidance,
	driverRequestReview,
	navigatorApprove,
	navigatorCodeReview,
	navigatorDeny,
} from "./mcpTools.js";

// Tool arrays for deriving names (to prevent tool/name mismatches)
const navigatorTools = [navigatorCodeReview, navigatorApprove, navigatorDeny];

const driverTools = [driverRequestReview, driverRequestGuidance];

/**
 * MCP server for Navigator communication tools
 * Provides tools for code review, approval/denial, and completion
 */
export const navigatorMcpServer = createSdkMcpServer({
	name: "navigator",
	version: "1.0.0",
	tools: navigatorTools,
});

/**
 * MCP server for Driver communication tools
 * Provides tools for requesting review
 */
export const driverMcpServer = createSdkMcpServer({
	name: "driver",
	version: "1.0.0",
	tools: driverTools,
});

/**
 * Tool names for Navigator (derived from tool definitions to prevent mismatches)
 */
export const NAVIGATOR_TOOL_NAMES = navigatorTools
	.map((tool) => tool?.name)
	.filter(Boolean);

/**
 * Tool names for Driver (derived from tool definitions to prevent mismatches)
 */
export const DRIVER_TOOL_NAMES = driverTools
	.map((tool) => tool?.name)
	.filter(Boolean);
