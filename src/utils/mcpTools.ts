/**
 * MCP Tool Definitions for Pair Programming Communication
 *
 * Defines structured tools for communication between Navigator and Driver agents
 * using the Claude Code SDK MCP framework with zod validation.
 */

import { tool } from "@anthropic-ai/claude-code";
import { z } from "zod";

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
	async (_args) => {
		return { content: [] };
	},
);

export const navigatorComplete = tool(
	"navigatorComplete",
	"Navigator marks the task as complete",
	{
		summary: z.string().describe("Summary of what was accomplished"),
	},
	async (_args) => {
		return { content: [] };
	},
);

export const navigatorApprove = tool(
	"navigatorApprove",
	"Navigator approves a driver's permission request",
	{
		comment: z.string().describe("Reason for approval"),
	},
	async (_args) => {
		return { content: [] };
	},
);

export const navigatorDeny = tool(
	"navigatorDeny",
	"Navigator denies a driver's permission request",
	{
		comment: z.string().describe("Reason for denial"),
	},
	async (_args) => {
		return { content: [] };
	},
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
