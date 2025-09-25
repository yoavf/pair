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

	const providerSegments: string[] = [];
	const modelSegments: string[] = [];

	if (activity) {
		// When there's activity, show it instead of provider/model info
		providerSegments.push(activity);
	} else if (providers && models) {
		if (phase === "planning") {
			// Planning phase: show architect only
			providerSegments.push(`Architect: ${providers.architect}`);
			modelSegments.push(`Model: ${formatModelName(models.architect)}`);
		} else if (phase === "execution" || phase === "review") {
			// Execution phase: show navigator and driver
			providerSegments.push(
				`Navigator: ${providers.navigator} | Driver: ${providers.driver}`,
			);
			modelSegments.push(
				`Models: ${formatModelName(models.navigator)} | ${formatModelName(models.driver)}`,
			);
		}
	}

	const providerText = providerSegments.join("  •  ") || " ";
	const modelText = modelSegments.join("  •  ");

	return (
		<Box flexDirection="column">
			<Text color="gray">{horizontalLine}</Text>
			<Text backgroundColor={absRightColor || undefined} color="white">
				{" ".repeat(terminalWidth)}
			</Text>
			{/* First line: Provider information */}
			<Box paddingX={1} justifyContent="space-between" marginTop={-1}>
				<Text
					backgroundColor={absRightColor || undefined}
					color={absRightColor ? "black" : "gray"}
				>
					{providerText}
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
			{/* Second line: Model information (if available) */}
			{modelText && (
				<Box paddingX={1} marginTop={0}>
					<Text
						backgroundColor={absRightColor || undefined}
						color={absRightColor ? "black" : "gray"}
					>
						{modelText}
					</Text>
				</Box>
			)}
		</Box>
	);
};

export default Footer;
