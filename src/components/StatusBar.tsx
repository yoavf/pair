import { Box, Text } from "ink";
import type React from "react";
import type { SessionPhase } from "../types.js";

interface Props {
	currentActivity: string;
	phase?: SessionPhase;
}

const PhasePill: React.FC<{ label: string; active?: boolean }> = ({
	label,
	active,
}) => (
	<Box
		marginX={1}
		paddingX={1}
		borderStyle={active ? "round" : "single"}
		borderColor={active ? "green" : "gray"}
	>
		<Text color={active ? "green" : "gray"}>{label}</Text>
	</Box>
);

const StatusBar: React.FC<Props> = ({ currentActivity, phase }) => {
	const terminalWidth = process.stdout.columns || 80;
	const horizontalLine = "─".repeat(terminalWidth);

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color="blue">{horizontalLine}</Text>
			<Box paddingX={1} justifyContent="space-between">
				<Text color="blue">ℹ️ {currentActivity}</Text>
				<Box>
					<PhasePill label="Planning" active={phase === "planning"} />
					<PhasePill label="Execution" active={phase === "execution"} />
					<PhasePill label="Review" active={phase === "review"} />
					<PhasePill label="Complete" active={phase === "complete"} />
				</Box>
			</Box>
			<Text color="blue">{horizontalLine}</Text>
		</Box>
	);
};

export default StatusBar;
