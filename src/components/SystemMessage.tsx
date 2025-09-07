import { Box } from "ink";
import React, { type FC } from "react";
import type { Message } from "../types.js";
import ToolMessage from "./ToolMessage.js";

interface Props {
	message: Message;
	isPlanning: boolean;
	entryKey: string;
	driverWidth: number;
	systemWidth: number;
}

const SystemMessage: FC<Props> = React.memo(
	({
		message,
		isPlanning: _isPlanning,
		entryKey,
		driverWidth,
		systemWidth,
	}) => {
		const isNavigator = message.sessionRole === "navigator";
		const text = (message.content || "").trim();
		const isTool =
			message.role === "system" &&
			[
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
			].some((tool) => text.startsWith(tool));

		const color = isTool ? "gray" : "white";
		const widthPct = isNavigator ? `${driverWidth}%` : `${systemWidth}%`;

		return (
			<Box key={entryKey} justifyContent="flex-start">
				<Box flexDirection="column" width={widthPct}>
					<ToolMessage
						content={message.content}
						color={color}
						sessionRole={message.sessionRole}
					/>
				</Box>
			</Box>
		);
	},
);

SystemMessage.displayName = "SystemMessage";

export default SystemMessage;
