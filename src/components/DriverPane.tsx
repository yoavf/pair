import { Box, Text } from "ink";
import type React from "react";
import type { Message } from "../types.js";

interface Props {
	messages: Message[];
}

const DriverPane: React.FC<Props> = ({ messages }) => {
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
				<Box key={`driver-system-${timestamp}`}>
					<Text dimColor>[{timestamp}] </Text>
					<Text color="yellow">⚙️ {message.content}</Text>
				</Box>
			);
		}

		return (
			<Box key={`driver-${timestamp}`} flexDirection="column">
				<Box>
					<Text dimColor>[{timestamp}] </Text>
					<Text bold color="green" underline>
						🚗 DRIVER:
					</Text>
				</Box>
				<Text color="green">{message.content}</Text>
			</Box>
		);
	};

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor="green"
			height="100%"
			width="100%"
			paddingX={1}
		>
			<Box marginBottom={1}>
				<Text bold color="green">
					🚗 DRIVER
				</Text>
			</Box>

			<Box flexDirection="column" flexGrow={1}>
				{messages.length === 0 ? (
					<Text dimColor>Waiting for navigator's plan...</Text>
				) : (
					messages.map(formatMessage)
				)}
			</Box>
		</Box>
	);
};

export default DriverPane;
