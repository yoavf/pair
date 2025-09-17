import { Box, Text } from "ink";
import React, { useCallback, useMemo } from "react";
import type { Message } from "../types.js";
import DriverMessage from "./DriverMessage.js";
import GenericMessage from "./GenericMessage.js";
import NavigatorMessage from "./NavigatorMessage.js";
import SystemMessage from "./SystemMessage.js";

interface Props {
	messages: Message[];
	phase?: "planning" | "execution" | "review" | "complete";
}

const ConversationView: React.FC<Props> = React.memo(({ messages, phase }) => {
	// Layout constants
	const DRIVER_WIDTH = 85; // percent width for bubbles
	const SYSTEM_WIDTH = 90; // percent width for tool/system lines
	const SEPARATOR = "-".repeat(60);

	const formatTimestamp = useCallback((timestamp: Date) => {
		return timestamp.toLocaleTimeString("en-US", {
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	}, []);

	const classifyMessages = useCallback((messages: Message[]) => {
		type Entry =
			| { kind: "system"; message: Message; key: string }
			| { kind: "driver"; message: Message; key: string }
			| { kind: "navigator"; message: Message; key: string }
			| { kind: "message"; message: Message; key: string };

		const entries: Entry[] = [];

		messages.forEach((message, index) => {
			const key = `${message.sessionRole}-${message.timestamp.getTime()}-${index}`;

			if (message.role === "system") {
				entries.push({ kind: "system", message, key });
				return;
			}

			if (message.sessionRole === "driver") {
				entries.push({ kind: "driver", message, key });
				return;
			}

			if (message.sessionRole === "navigator") {
				entries.push({ kind: "navigator", message, key });
				return;
			}

			entries.push({ kind: "message", message, key });
		});

		return entries;
	}, []);

	const formattedMessages = useMemo(() => {
		const entries = classifyMessages(messages);
		const isPlanning = phase === "planning";

		const nodes: React.ReactNode[] = [];
		let lastRole: "driver" | "navigator" | undefined;

		entries.forEach((entry) => {
			const { message } = entry;
			const timestamp = formatTimestamp(message.timestamp);

			if (entry.kind === "system") {
				nodes.push(
					<SystemMessage
						key={entry.key}
						message={message}
						isPlanning={isPlanning}
						entryKey={entry.key}
						driverWidth={DRIVER_WIDTH}
						systemWidth={SYSTEM_WIDTH}
					/>,
				);
				return;
			}

			if (entry.kind === "driver") {
				if (lastRole && lastRole !== "driver") {
					nodes.push(
						<Box key={`${entry.key}-sep`} justifyContent={"flex-start"}>
							<Text dimColor>{SEPARATOR}</Text>
						</Box>,
					);
				}
				const showHeader = lastRole !== "driver";
				lastRole = "driver";
				nodes.push(
					<DriverMessage
						key={entry.key}
						message={message}
						reactions={[]}
						showHeader={showHeader}
						timestamp={timestamp}
						entryKey={entry.key}
						driverWidth={DRIVER_WIDTH}
						separator={SEPARATOR}
					/>,
				);
				return;
			}

			if (entry.kind === "navigator") {
				const currentRole: "driver" | "navigator" = "navigator";
				const roleChanged = lastRole && lastRole !== currentRole;
				if (roleChanged) {
					nodes.push(
						<Box key={`${entry.key}-sep`} justifyContent={"flex-start"}>
							<Text dimColor>{SEPARATOR}</Text>
						</Box>,
					);
				}
				const showHeader = !!roleChanged && !isPlanning;
				lastRole = currentRole;

				nodes.push(
					<NavigatorMessage
						key={entry.key}
						message={message}
						showHeader={showHeader}
						timestamp={timestamp}
						entryKey={entry.key}
						isPlanning={isPlanning}
						driverWidth={DRIVER_WIDTH}
					/>,
				);
				return;
			}

			const isNavigator = message.sessionRole === "navigator";
			const isNavigatorOrArchitect =
				isNavigator || message.sessionRole === "architect";
			const currentRole: "driver" | "navigator" = isNavigatorOrArchitect
				? "navigator"
				: "driver";
			const roleChanged = lastRole && lastRole !== currentRole;

			if (roleChanged) {
				nodes.push(
					<Box key={`${entry.key}-sep`} justifyContent={"flex-start"}>
						<Text dimColor>{SEPARATOR}</Text>
					</Box>,
				);
			}

			const showHeader = !!roleChanged;
			lastRole = currentRole;

			nodes.push(
				<GenericMessage
					key={entry.key}
					message={message}
					showHeader={showHeader}
					timestamp={timestamp}
					entryKey={entry.key}
					driverWidth={DRIVER_WIDTH}
				/>,
			);
		});

		return nodes;
	}, [messages, formatTimestamp, phase, classifyMessages]);

	return (
		<Box flexDirection="column" height="100%" paddingX={1}>
			{messages.length === 0 ? (
				<Text dimColor>Starting conversation...</Text>
			) : (
				formattedMessages
			)}
		</Box>
	);
});

ConversationView.displayName = "ConversationView";

export default ConversationView;
