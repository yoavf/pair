import { Box, Text } from "ink";
import React, { type FC } from "react";
import type { Message } from "../types.js";

interface Props {
	message: Message;
	showHeader: boolean;
	timestamp: string;
	entryKey: string;
	isPlanning: boolean;
	driverWidth: number;
}

const NavigatorMessage: FC<Props> = React.memo(
	({
		message,
		showHeader,
		timestamp,
		entryKey,
		isPlanning: _isPlanning,
		driverWidth,
	}) => {
		return (
			<Box key={entryKey} justifyContent="flex-start" marginY={1}>
				<Box flexDirection="column" width={`${driverWidth}%`}>
					{showHeader && (
						<Box marginBottom={1} justifyContent="flex-start">
							<Text dimColor>[{timestamp}] </Text>
							<Text bold color="cyan">
								🧭 NAVIGATOR:
							</Text>
						</Box>
					)}
					<Box paddingX={1}>
						<Text color="white">{message.content}</Text>
					</Box>
				</Box>
			</Box>
		);
	},
);

NavigatorMessage.displayName = "NavigatorMessage";

export default NavigatorMessage;
