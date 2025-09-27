import { Text } from "ink";
import type React from "react";

interface Props {
	content: string;
	color: string;
	sessionRole: "navigator" | "driver";
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
	const text = content?.toString() ?? "";
	const dashIndex = text.indexOf(" - ");

	// Determine leading symbol: defaults are driver -> ⏺ white, navigator -> • cyan
	const defaultSymbol = sessionRole === "navigator" ? "•" : "⏺";
	const defaultSymbolColor = sessionRole === "navigator" ? "cyan" : "white";
	const hasCustom = symbol !== undefined;
	const effSymbol = hasCustom ? symbol! : defaultSymbol;
	const effColor = hasCustom
		? symbolColor || defaultSymbolColor
		: defaultSymbolColor;
	const pieces: React.ReactElement[] = [];
	if (sessionRole === "navigator") {
		// Threading symbol before navigator tool results
		pieces.push(
			<Text key="nav-arrow" color="white">
				{" "}
				⎿ {""}
			</Text>,
		);
	}
	if (effSymbol) {
		pieces.push(
			<Text
				key={`sym-${effSymbol}`}
				color={effColor}
				bold={sessionRole === "navigator"}
			>
				{" "}
				{effSymbol}{" "}
			</Text>,
		);
	}

	const getIndentationForContinuation = () => {
		if (sessionRole === "navigator") {
			return "       ";
		}
		return "  ";
	};

	const indentString = getIndentationForContinuation();

	if (dashIndex > 0) {
		// Has details: "ToolName - details"
		const toolName = text.substring(0, dashIndex);
		const details = text
			.substring(dashIndex)
			.replace(/\n/g, `\n${indentString}`);
		return (
			<Text wrap="wrap">
				{pieces}
				<Text color={color} bold>
					{toolName}
				</Text>
				<Text color={color}>{details}</Text>
			</Text>
		);
	} else {
		// No details: simple indentation for continuation lines
		const pretty = text.replace(/\n/g, `\n${indentString}`);
		return (
			<Text wrap="wrap">
				{pieces}
				<Text color={color} bold>
					{pretty}
				</Text>
			</Text>
		);
	}
};

export default ToolMessage;
