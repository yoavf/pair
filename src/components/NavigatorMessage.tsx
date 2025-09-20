import { Box, Text } from "ink";
import React, { type FC } from "react";
import type { Message } from "../types.js";
import Markdown from "./Markdown.js";

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
		const isPlan = message.content.startsWith("📋 PLAN CREATED:");
		const widthPct = isPlan
			? `${Math.min(driverWidth + 8, 98)}%`
			: `${driverWidth}%`;

		return (
			<Box key={entryKey} justifyContent="flex-start" marginY={1}>
				<Box flexDirection="column" width={widthPct}>
					{showHeader && (
						<Box marginBottom={1} justifyContent="flex-start">
							<Text dimColor>[{timestamp}] </Text>
							<Text bold color="cyan">
								🧭 NAVIGATOR:
							</Text>
						</Box>
					)}

					{isPlan ? (
						<Box flexDirection="column" paddingX={1}>
							{/* Header */}
							<Text color="white" bold>
								{message.content.split("\n")[0]}
							</Text>
							{/* Plan content using the same Task box style */}
							{(() => {
								const planText = message.content
									.split("\n")
									.slice(1)
									.join("\n");
								return (
									<Box
										marginTop={1}
										marginX={2}
										paddingY={1}
										paddingX={2}
										borderStyle="round"
										borderColor="gray"
									>
										<Markdown>{planText}</Markdown>
									</Box>
								);
							})()}
						</Box>
					) : (
						<Box paddingX={1}>
							<Text color="white">{message.content}</Text>
						</Box>
					)}
				</Box>
			</Box>
		);
	},
);

NavigatorMessage.displayName = "NavigatorMessage";

export default NavigatorMessage;
