import { Box, Text, useInput } from "ink";
import type React from "react";
import { hasAbsolutelyRightPhrase, useAbsRight } from "../hooks/useAbsRight.js";
import type {
	AgentConfiguration,
	AgentProviders,
	SessionPhase,
} from "../types.js";
import { formatModelName } from "../utils/modelDisplay.js";

interface Props {
	onExit: () => void;
	phase?: SessionPhase;
	activity?: string;
	quitState?: "normal" | "confirm";
	onCtrlC?: () => void;
	allMessages?: string; // Combined content of recent messages for detection
	providers?: AgentProviders;
	models?: AgentConfiguration;
}

const Footer: React.FC<Props> = ({
	onExit,
	phase,
	activity,
	quitState = "normal",
	onCtrlC,
	allMessages = "",
	providers,
	models,
}) => {
	const hasPhrase = hasAbsolutelyRightPhrase(allMessages);
	const absRightColor = useAbsRight(hasPhrase);
	useInput((input: string, key: { ctrl?: boolean }) => {
		if (key.ctrl && input === "c") {
			if (onCtrlC) {
				onCtrlC();
			} else {
				onExit();
			}
		}
	});

	const terminalWidth = process.stdout.columns || 80;
	const horizontalLine = "─".repeat(terminalWidth);

	let line1 = "";
	let line2 = "";

	if (activity) {
		// When there's activity, show it on the first line
		line1 = activity;
	} else if (providers && models) {
		if (phase === "planning") {
			// Planning phase: show architect only
			line1 = `Architect: ${providers.architect} / ${formatModelName(models.architect)}`;
		} else if (phase === "execution" || phase === "review") {
			// Execution phase: show driver on line 1, navigator on line 2
			line1 = `Driver: ${providers.driver} / ${formatModelName(models.driver)}`;
			line2 = `Navigator: ${providers.navigator} / ${formatModelName(models.navigator)}`;
		}
	}

	return (
		<Box flexDirection="column">
			<Text color="gray">{horizontalLine}</Text>
			<Text backgroundColor={absRightColor || undefined} color="white">
				{" ".repeat(terminalWidth)}
			</Text>
			{/* First line: Driver or Architect */}
			<Box paddingX={1} justifyContent="space-between" marginTop={-1}>
				<Text
					backgroundColor={absRightColor || undefined}
					color={absRightColor ? "black" : "gray"}
				>
					{line1 || " "}
				</Text>
				<Text
					backgroundColor={absRightColor || undefined}
					color={absRightColor ? "black" : "gray"}
				>
					{quitState === "confirm"
						? "Press Ctrl+C again to exit"
						: "Press Ctrl+C to quit"}
				</Text>
			</Box>
			{/* Second line: Navigator (if available) */}
			{line2 && (
				<Box paddingX={1} marginTop={0}>
					<Text
						backgroundColor={absRightColor || undefined}
						color={absRightColor ? "black" : "gray"}
					>
						{line2}
					</Text>
				</Box>
			)}
		</Box>
	);
};

export default Footer;
