import { Box, Text } from "ink";
import type React from "react";
import type { Message } from "../types.js";

interface Props {
	message: Message;
	showHeader: boolean;
	timestamp: string;
	entryKey: string;
	driverWidth: number;
}

const GenericMessage: React.FC<Props> = ({
	message,
	showHeader,
	timestamp,
	entryKey,
	driverWidth,
}) => {
	const isNavigator =
		message.sessionRole === "navigator" || message.sessionRole === "architect";

	return (
		<Box key={entryKey} justifyContent={"flex-start"} marginY={1}>
			<Box flexDirection="column" width={`${driverWidth}%`}>
				{showHeader && (
					<Box marginBottom={1}>
						<Text dimColor>[{timestamp}] </Text>
						{isNavigator ? (
							<Text bold color="cyan">
								{message.sessionRole === "architect"
									? "🏗️ ARCHITECT:"
									: "🧭 NAVIGATOR:"}
							</Text>
						) : (
							<Text bold color="green">
								🚗 DRIVER:
							</Text>
						)}
					</Box>
				)}
				<Box paddingX={1}>
					<Text color="white">{message.content}</Text>
				</Box>
			</Box>
		</Box>
	);
};

export default GenericMessage;
