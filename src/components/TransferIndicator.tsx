import { Box, Text } from "ink";
import type React from "react";
import type { Role } from "../types.js";

interface Props {
	from: Role;
	to: Role;
	timestamp: Date;
}

const TransferIndicator: React.FC<Props> = ({ from, to, timestamp }) => {
	const getRoleColor = (role: Role) => {
		return role === "navigator" ? "cyan" : "green";
	};

	const formatTimestamp = (timestamp: Date) => {
		return timestamp.toLocaleTimeString("en-US", {
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	};

	return (
		<Box justifyContent="center" marginY={1}>
			<Text dimColor>[{formatTimestamp(timestamp)}] </Text>
			<Text color={getRoleColor(from)} bold>
				{from.toUpperCase()}
			</Text>
			<Text dimColor> =&gt; sent to </Text>
			<Text color={getRoleColor(to)} bold>
				{to.toUpperCase()}
			</Text>
		</Box>
	);
};

export default TransferIndicator;
