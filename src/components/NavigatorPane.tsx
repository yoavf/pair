import { Box, Text } from "ink";
import type React from "react";
import type { Message } from "../types.js";

interface Props {
	messages: Message[];
}

const NavigatorPane: React.FC<Props> = ({ messages }) => {
	const formatTimestamp = (timestamp: Date) => {
		return timestamp.toLocaleTimeString("en-US", {
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	};

	const formatMessage = (message: Message) => {
		const timestamp = formatTimestamp(message.timestamp);

		if (message.role === "system") {
			// Tool use messages
			return (
				<Box key={`navigator-system-${timestamp}`}>
					<Text dimColor>[{timestamp}] </Text>
					<Text color="yellow">⚙️ {message.content}</Text>
				</Box>
			);
		}

		return (
			<Box key={`navigator-${timestamp}`} flexDirection="column">
				<Box>
					<Text dimColor>[{timestamp}] </Text>
					<Text bold color="cyan" underline>
						🧭 NAVIGATOR:
					</Text>
				</Box>
				<Text color="cyan">{message.content}</Text>
			</Box>
		);
	};

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor="cyan"
			height="100%"
			width="100%"
			paddingX={1}
		>
			<Box marginBottom={1}>
				<Text bold color="cyan">
					🧭 NAVIGATOR
				</Text>
			</Box>

			<Box flexDirection="column" flexGrow={1}>
				{messages.map(formatMessage)}
			</Box>
		</Box>
	);
};

export default NavigatorPane;
