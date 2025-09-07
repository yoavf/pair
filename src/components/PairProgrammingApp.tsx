import { Box } from "ink";
import type React from "react";
import type { PairProgrammingState } from "../types.js";
import ConversationView from "./ConversationView.js";
import Footer from "./Footer.js";
import Header from "./Header.js";

interface Props {
	state: PairProgrammingState;
	onExit: () => void;
	onCtrlC?: () => void;
}

const PairProgrammingApp: React.FC<Props> = ({ state, onExit, onCtrlC }) => {
	// Combine all messages in chronological order
	const allMessages = [
		...state.navigatorMessages,
		...state.driverMessages,
	].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

	// Get recent message content for easter egg detection
	const recentContent = allMessages
		.slice(-3)
		.map((m) => m.content)
		.join(" ");

	return (
		<Box flexDirection="column" height="100%">
			<Header projectPath={state.projectPath} initialTask={state.initialTask} />

			{/* Status bar removed; phase/state shown in Footer */}

			<Box flexGrow={1}>
				<ConversationView messages={allMessages} phase={state.phase} />
			</Box>

			{/* Removed transient transfer banner */}

			<Footer
				onExit={onExit}
				phase={state.phase}
				activity={state.currentActivity}
				quitState={state.quitState}
				onCtrlC={onCtrlC}
				allMessages={recentContent}
			/>
		</Box>
	);
};

export default PairProgrammingApp;
