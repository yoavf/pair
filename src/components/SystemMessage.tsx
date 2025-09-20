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
		const text = String(message.content || "");
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

		// Add vertical padding for special decision/request lines
		const isSpecial =
			Boolean(message.symbol) ||
			/^(\s*)(✓|Denied|📋|🔍|❓|Completed|Requested)/.test(text);

		const color = isTool ? "gray" : "white";
		const widthChars = isNavigator ? driverWidth : systemWidth;

		// For navigator special lines, avoid adding a blank line before; keep a small space after.
		const marginTop = isSpecial ? (isNavigator ? 0 : 1) : 0;
		const marginBottom = isSpecial ? 1 : 0;

		return (
			<Box
				key={entryKey}
				justifyContent="flex-start"
				marginTop={marginTop}
				marginBottom={marginBottom}
			>
				<Box flexDirection="column" width={widthChars}>
					<ToolMessage
						content={message.content}
						color={color}
						sessionRole={message.sessionRole}
						symbol={message.symbol}
						symbolColor={message.symbolColor}
					/>
				</Box>
			</Box>
		);
	},
);

SystemMessage.displayName = "SystemMessage";

export default SystemMessage;
