import { Text } from "ink";
import type React from "react";

interface Props {
	content: string;
	color: string;
	sessionRole: "navigator" | "driver" | "architect";
}

const ToolMessage: React.FC<Props> = ({ content, color, sessionRole }) => {
	const text = content.trim();
	const dashIndex = text.indexOf(" - ");

	const dot =
		sessionRole === "navigator" ? (
			<Text color="cyan"> ⤷ ⏺ </Text>
		) : (
			<Text color="white"> ⏺ </Text>
		);

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
		// No details, just tool name
		return (
			<Text>
				{dot}
				<Text color={color} bold>
					{text}
				</Text>
			</Text>
		);
	}
};

export default ToolMessage;
