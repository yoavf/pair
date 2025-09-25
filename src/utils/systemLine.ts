import type { Role } from "../types.js";

export interface SystemLineFormat {
	content: string;
	symbol?: string;
	symbolColor?: string;
}

// Build a human system line and a leading symbol for known MCP tools
// - navigatorApprove -> ✓ (greenBright)
// - navigatorDeny -> x (red)
// - navigatorCodeReview -> • (cyan)
// - driverRequestReview -> text only (no symbol override)
function toNavigatorToolId(tool: string): string | null {
	if (tool.startsWith("mcp__navigator__")) return tool;
	if (tool.startsWith("pair-navigator_")) {
		const suffix = tool.slice("pair-navigator_".length);
		return `mcp__navigator__${suffix}`;
	}
	return null;
}

function toDriverToolId(tool: string): string | null {
	if (tool.startsWith("mcp__driver__")) return tool;
	if (tool.startsWith("pair-driver_")) {
		const suffix = tool.slice("pair-driver_".length);
		return `mcp__driver__${suffix}`;
	}
	return null;
}

export function formatSystemLine(
	role: Role,
	tool: string,
	// biome-ignore lint/suspicious/noExplicitAny: tool parameters are dynamic
	params?: any,
): SystemLineFormat | null {
	const navigatorTool = toNavigatorToolId(tool);
	if (role === "navigator" && navigatorTool) {
		const comment =
			params && typeof params.comment === "string" ? params.comment : "";
		const _summary =
			params && typeof (params as any).summary === "string"
				? (params as any).summary
				: "";

		if (navigatorTool === "mcp__navigator__navigatorApprove") {
			return {
				content: `Approved${comment ? `: ${comment}` : ""}`,
				symbol: "✓",
				symbolColor: "#00ff00",
			};
		}
		if (navigatorTool === "mcp__navigator__navigatorDeny") {
			return {
				content: `Denied${comment ? `: ${comment}` : ""}`,
				symbol: "x",
				symbolColor: "#ff0000",
			};
		}
		if (navigatorTool === "mcp__navigator__navigatorCodeReview") {
			const pass = params && params.pass === true;
			return {
				content: `Code Review${pass ? ` (pass)` : comment ? `: ${comment}` : ""}`,
				symbol: "•",
				symbolColor: "cyan",
			};
		}
	}

	const driverTool = toDriverToolId(tool);
	if (role === "driver" && driverTool) {
		const ctx =
			params && typeof params.context === "string" ? params.context : "";
		if (driverTool === "mcp__driver__driverRequestReview") {
			return {
				content: `🔍 Review requested${ctx ? `: ${ctx}` : ""}`,
				symbol: "",
			};
		}
		if (driverTool === "mcp__driver__driverRequestGuidance") {
			return {
				content: `🧭 Guidance requested${ctx ? `: ${ctx}` : ""}`,
				symbol: "",
			};
		}
	}

	return null;
}
