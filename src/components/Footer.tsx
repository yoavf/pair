import { Box, Text, useInput } from "ink";
import type React from "react";
import { hasAbsolutelyRightPhrase, useAbsRight } from "../hooks/useAbsRight.js";
import type { AgentProviders, SessionPhase } from "../types.js";

interface Props {
	onExit: () => void;
	phase?: SessionPhase;
	activity?: string;
	quitState?: "normal" | "confirm";
	onCtrlC?: () => void;
	allMessages?: string; // Combined content of recent messages for detection
	providers?: AgentProviders;
}

const Footer: React.FC<Props> = ({
	onExit,
	phase,
	activity,
	quitState = "normal",
	onCtrlC,
	allMessages = "",
	providers,
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

	const segments: string[] = [];
	if (phase) {
		segments.push(`${phase[0].toUpperCase()}${phase.slice(1)}`);
	}
	if (activity) {
		segments.push(activity);
	}
	if (providers) {
		if (phase === "planning") {
			segments.push(`Architect: ${providers.architect}`);
		} else if (phase === "execution" || phase === "review") {
			segments.push(
				`Navigator: ${providers.navigator} | Driver: ${providers.driver}`,
			);
		}
	}

	const leftText = segments.join("  •  ") || " ";

	return (
		<Box flexDirection="column">
			<Text color="gray">{horizontalLine}</Text>
			<Text backgroundColor={absRightColor || undefined} color="white">
				{" ".repeat(terminalWidth)}
			</Text>
			<Box paddingX={1} justifyContent="space-between" marginTop={-1}>
				<Text
					backgroundColor={absRightColor || undefined}
					color={absRightColor ? "black" : "gray"}
				>
					{leftText}
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
		</Box>
	);
};

export default Footer;
