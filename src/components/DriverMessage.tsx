import { Box, Text } from "ink";
import React, { type FC } from "react";
import type { Message } from "../types.js";

interface Props {
	message: Message;
	reactions: Message[];
	showTimestamp: boolean;
	shortTime: string;
	entryKey: string;
	driverWidth: number;
	separator: string;
}

const DriverMessage: FC<Props> = React.memo(
	({
		message,
		reactions,
		showTimestamp,
		shortTime,
		entryKey,
		driverWidth,
		separator: _separator,
	}) => {
		return (
			<Box key={entryKey} flexDirection="column" width="100%" marginY={1}>
				<Box justifyContent={"flex-start"}>
					<Box flexDirection="column" width={driverWidth}>
						<Box paddingX={1}>
							<Text color="white" wrap="wrap">
								{message.content}
							</Text>
						</Box>
					</Box>
				</Box>
				{reactions.length > 0 && (
					<Box flexDirection="column" width={driverWidth} marginTop={0}>
						{reactions.map((reactMsg: Message, idx: number) => (
							<Box
								key={`${entryKey}-react-${reactMsg.timestamp.getTime()}-${idx}`}
								justifyContent={"flex-end"}
								marginY={0}
							>
								<Box>
									<Text color={"cyan"}>
										<Text bold>⎿ Navigator:</Text> {reactMsg.content}
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
