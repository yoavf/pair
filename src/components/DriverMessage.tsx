import { Box, Text } from "ink";
import React, { type FC } from "react";
import type { Message } from "../types.js";

interface Props {
	message: Message;
	reactions: Message[];
	showHeader: boolean;
	timestamp: string;
	entryKey: string;
	driverWidth: number;
	separator: string;
}

const DriverMessage: FC<Props> = React.memo(
	({
		message,
		reactions,
		showHeader,
		timestamp,
		entryKey,
		driverWidth,
		separator: _separator,
	}) => {
		return (
			<Box key={entryKey} flexDirection="column" width="100%" marginY={1}>
				<Box justifyContent={"flex-start"}>
					<Box flexDirection="column" width={`${driverWidth}%`}>
						{showHeader && (
							<Box marginBottom={1}>
								<Text dimColor>[{timestamp}] </Text>
								<Text bold color="green">
									🚗 DRIVER:
								</Text>
							</Box>
						)}
						<Box paddingX={1}>
							<Text color="white">
								{message.content
									.split("\n")
									.filter((line: string) => {
										const isTool = [
											"Read",
											"Write",
											"Edit",
											"MultiEdit",
											"Bash",
											"Grep",
											"Glob",
											"TodoWrite",
											"WebSearch",
											"WebFetch",
										].some((tool) => line.startsWith(tool));
										const isHint =
											line.startsWith("🔎 Verify:") ||
											line.startsWith("🔧 Tip:");
										return !(isTool || isHint);
									})
									.join("\n")}
							</Text>
						</Box>
					</Box>
				</Box>
				{reactions.length > 0 && (
					<Box flexDirection="column" width={`${driverWidth}%`} marginTop={0}>
						{reactions.map((reactMsg: Message, idx: number) => (
							<Box
								key={`${entryKey}-react-${reactMsg.timestamp.getTime()}-${idx}`}
								justifyContent={"flex-end"}
								marginY={0}
							>
								<Box>
									<Text color={"cyan"}>
										<Text bold>⤷ Navigator:</Text> {reactMsg.content}
									</Text>
								</Box>
							</Box>
						))}
					</Box>
				)}
			</Box>
		);
	},
);

DriverMessage.displayName = "DriverMessage";

export default DriverMessage;
