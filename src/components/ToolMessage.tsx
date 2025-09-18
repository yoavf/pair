import { Text } from "ink";
import type React from "react";

interface Props {
	content: string;
	color: string;
	sessionRole: "navigator" | "driver" | "architect";
	symbol?: string; // set to "" to suppress the default symbol
	symbolColor?: string;
}

const ToolMessage: React.FC<Props> = ({
	content,
	color,
	sessionRole,
	symbol,
	symbolColor,
}) => {
	const text = String(content ?? "");
	const dashIndex = text.indexOf(" - ");

	// Determine leading symbol: defaults are driver -> ⏺ white, navigator -> • cyan
	const defaultSymbol = sessionRole === "navigator" ? "•" : "⏺";
	const defaultSymbolColor = sessionRole === "navigator" ? "cyan" : "white";
	const hasCustom = symbol !== undefined;
	const effSymbol = hasCustom ? symbol! : defaultSymbol;
	const effColor = hasCustom
		? symbolColor || defaultSymbolColor
		: defaultSymbolColor;
	const dot: React.ReactNode = effSymbol ? (
		<Text color={effColor}> {effSymbol} </Text>
	) : null;

	if (dashIndex > 0) {
		// Has details: "ToolName - details"
		const toolName = text.substring(0, dashIndex);
		const details = text.substring(dashIndex);
		return (
			<Text>
				{dot}
				<Text color={color} bold>
					{toolName}
				</Text>
				<Text color={color}>{details}</Text>
			</Text>
		);
	} else {
		// No details: allow multi-line content and indent continuation lines for readability
		// Indent any newline continuations by two spaces
		const pretty = text.replace(/\n/g, "\n  ");
		return (
			<Text>
				{dot}
				<Text color={color} bold>
					{pretty}
				</Text>
			</Text>
		);
	}
};

export default ToolMessage;
