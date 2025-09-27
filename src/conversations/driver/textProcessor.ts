/**
 * Text processing utilities for Driver
 */

/**
 * Normalize assistant text by removing excess whitespace and normalizing line breaks
 */
export function normalizeAssistantText(text: string): string {
	const noCarriage = text.replace(/\r/g, "");
	const sentinel = "__PAIR_PARA__";
	const withSentinel = noCarriage.replace(/\n{2,}/g, ` ${sentinel} `);
	const collapsed = withSentinel.replace(/\n+/g, " ");
	const singleSpaced = collapsed.replace(/\s+/g, " ").trim();
	const restored = singleSpaced
		.replace(new RegExp(`\\s*${sentinel}\\s*`, "g"), "\n\n")
		.trim();
	return restored;
}

/**
 * Combine messages for sending to navigator
 */
export function combineMessagesForNavigator(messages: string[]): string {
	if (messages.length === 0) return "";

	if (messages.length === 1) {
		return messages[0];
	}

	return messages.map((msg) => `\n${msg}`).join("\n\n");
}
