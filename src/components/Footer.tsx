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

	const isApprovalWaiting = activity?.startsWith(
		"Awaiting navigator approval:",
	);

	return (
		<Box flexDirection="column">
			<Text color="gray">{horizontalLine}</Text>
			<Text backgroundColor={absRightColor || undefined} color="white">
				{" ".repeat(terminalWidth)}
			</Text>
			{/* First line: Driver or Architect */}
			<Box paddingX={1} justifyContent="space-between" marginTop={-1}>
				<Box>
					{providers && models && phase === "planning" && (
						<Text
							backgroundColor={absRightColor || undefined}
							color={absRightColor ? "black" : "gray"}
						>
							<Text bold>Architect</Text>: {providers.architect} /{" "}
							{formatModelName(models.architect)}
						</Text>
					)}
					{providers &&
						models &&
						(phase === "execution" || phase === "review") && (
							<Text
								backgroundColor={absRightColor || undefined}
								color={absRightColor ? "black" : "gray"}
							>
								<Text bold>Driver</Text>: {providers.driver} /{" "}
								{formatModelName(models.driver)}
							</Text>
						)}
					{(!providers ||
						!models ||
						(phase !== "planning" &&
							phase !== "execution" &&
							phase !== "review")) && (
						<Text
							backgroundColor={absRightColor || undefined}
							color={absRightColor ? "black" : "gray"}
						>
							Something went wrong - no agent info available.
						</Text>
					)}
				</Box>
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
			{providers &&
				models &&
				(phase === "execution" || phase === "review") &&
				!isApprovalWaiting && (
					<Box paddingX={1} marginTop={0}>
						<Text
							backgroundColor={absRightColor || undefined}
							color={absRightColor ? "black" : "gray"}
						>
							<Text bold>Navigator</Text>: {providers.navigator} /{" "}
							{formatModelName(models.navigator)}
						</Text>
					</Box>
				)}
			{isApprovalWaiting && (
				<Box paddingX={1} marginTop={0}>
					<Text
						backgroundColor={absRightColor || undefined}
						color={absRightColor ? "black" : "gray"}
					>
						{activity}
					</Text>
				</Box>
			)}
		</Box>
	);
};

export default Footer;
