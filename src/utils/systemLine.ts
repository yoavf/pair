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
// - navigatorComplete -> ⏹ (greenBright)
// - driverRequestReview -> text only (no symbol override)
export function formatSystemLine(
	role: Role,
	tool: string,
	// biome-ignore lint/suspicious/noExplicitAny: tool parameters are dynamic
	params?: any,
): SystemLineFormat | null {
	if (role === "navigator" && tool.startsWith("mcp__navigator__")) {
		const comment =
			params && typeof params.comment === "string" ? params.comment : "";
		const summary =
			params && typeof (params as any).summary === "string"
				? (params as any).summary
				: "";

		if (tool === "mcp__navigator__navigatorApprove") {
			return {
				content: `Approved${comment ? `: ${comment}` : ""}`,
				symbol: "✓",
				symbolColor: "#00ff00",
			};
		}
		if (tool === "mcp__navigator__navigatorDeny") {
			return {
				content: `Denied${comment ? `: ${comment}` : ""}`,
				symbol: "x",
				symbolColor: "#ff0000",
			};
		}
		if (tool === "mcp__navigator__navigatorCodeReview") {
			return {
				content: `Code Review${comment ? `: ${comment}` : ""}`,
				symbol: "•",
				symbolColor: "cyan",
			};
		}
		if (tool === "mcp__navigator__navigatorComplete") {
			return {
				content: `Completed${summary ? `: ${summary}` : ""}`,
				symbol: "⏹",
				symbolColor: "#00ff00",
			};
		}
	}

	if (role === "driver" && tool.startsWith("mcp__driver__")) {
		const ctx =
			params && typeof params.context === "string" ? params.context : "";
		if (tool === "mcp__driver__driverRequestReview") {
			return {
				content: `🔍 Review requested${ctx ? `: ${ctx}` : ""}`,
				symbol: "",
			};
		}
	}

	return null;
}
