/**
 * Shared tool utilities for agents
 */

/**
 * Generate a short, human-friendly message ID
 * Used by both Driver and Navigator for message tracking
 */
export function generateMessageId(): string {
	const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
	const ts = Date.now().toString(36).slice(-2).toUpperCase();
	return `${ts}${rand}`; // short, human-friendly
}

/**
 * Extract content from a tool result item
 * @param item - The tool result item from Claude Agent SDK
 */
export function extractResultContent(item: any): any {
	if (!item) return item; // Handle null/undefined
	if (item.text) return item.text;
	if (item.content) return item.content;
	if (item.result) return item.result;
	return item; // Return the whole item if we can't find specific content
}

/**
 * Generic MCP tool name normalizer
 * @param toolName - The tool name to normalize
 * @param role - The agent role (driver, navigator, etc.)
 */
export function normalizeMcpTool(toolName: string, role: string): string {
	const mcpPrefix = `mcp__${role}__`;
	const legacyPrefix = `pair-${role}_`;

	if (toolName.startsWith(mcpPrefix)) {
		return toolName;
	}
	if (toolName.startsWith(legacyPrefix)) {
		return `${mcpPrefix}${toolName.slice(legacyPrefix.length)}`;
	}
	return toolName;
}

/**
 * Check if a tool is an approved edit tool (that should be filtered from navigator messages)
 */
export function isApprovedEditTool(toolName: string): boolean {
	return (
		toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit"
	);
}
