/**
 * MCP Tool Definitions for Pair Programming Communication
 *
 * Defines structured tools for communication between Navigator and Driver agents
 * using the Claude Code SDK MCP framework with zod validation.
 */

import { tool } from "@anthropic-ai/claude-code";
import { z } from "zod";

/**
 * Creates a no-op handler for communication-only MCP tools.
 *
 * Navigator tools are purely communicative - the tool call itself carries
 * the semantic meaning (e.g., "I approve this" or "I deny this"), and the
 * empty content array indicates successful communication without user-visible output.
 *
 * Driver tools, in contrast, return descriptive content for user feedback.
 */
const createNoOpHandler = () => async (_args: any) => ({ content: [] });

// Navigator tool definitions
export const navigatorCodeReview = tool(
	"navigatorCodeReview",
	"Navigator provides code review feedback for driver implementation",
	{
		comment: z.string().describe("Assessment of the implementation"),
		pass: z
			.boolean()
			.describe(
				"Whether the implementation passes review (true) or needs more work (false)",
			),
	},
	createNoOpHandler(),
);

export const navigatorApprove = tool(
	"navigatorApprove",
	"Navigator approves a driver's permission request",
	{
		requestId: z
			.string()
			.optional()
			.describe("ID of the permission request being approved"),
		comment: z.string().describe("Reason for approval"),
	},
	createNoOpHandler(),
);

export const navigatorDeny = tool(
	"navigatorDeny",
	"Navigator denies a driver's permission request",
	{
		requestId: z
			.string()
			.optional()
			.describe("ID of the permission request being denied"),
		comment: z.string().describe("Reason for denial"),
	},
	createNoOpHandler(),
);

// Driver tool definitions
export const driverRequestReview = tool(
	"driverRequestReview",
	"Driver requests review of implementation progress",
	{
		context: z
			.string()
			.optional()
			.describe("Optional context about what was implemented"),
	},
	async (args) => {
		return {
			content: [
				{
					type: "text",
					text: `🔍 Requesting review${args.context ? `: ${args.context}` : ""}`,
				},
			],
		};
	},
);

export const driverRequestGuidance = tool(
	"driverRequestGuidance",
	"Driver requests guidance when stuck or needs direction",
	{
		context: z
			.string()
			.describe(
				"Description of what the driver is stuck on or needs help with",
			),
	},
	async (args) => {
		return {
			content: [
				{
					type: "text",
					text: `🤔 Requesting guidance: ${args.context}`,
				},
			],
		};
	},
);
