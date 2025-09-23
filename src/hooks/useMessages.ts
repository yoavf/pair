import { useCallback, useState } from "react";
import type {
	AgentProviders,
	Message,
	PairProgrammingState,
	SessionPhase,
} from "../types.js";

const UNKNOWN_PROVIDERS: AgentProviders = {
	architect: "unknown",
	navigator: "unknown",
	driver: "unknown",
};

export const useMessages = (
	projectPath: string,
	initialTask: string,
	providers: AgentProviders = UNKNOWN_PROVIDERS,
) => {
	const [state, setState] = useState<PairProgrammingState>({
		projectPath,
		initialTask,
		navigatorMessages: [],
		driverMessages: [],
		currentActivity: "",
		phase: "planning",
		quitState: "normal",
		providers,
	});

	const addMessage = useCallback((message: Message) => {
		setState((prev) => {
			const currentMessages =
				message.sessionRole === "navigator"
					? prev.navigatorMessages
					: prev.driverMessages;

			// Limit message history to prevent performance issues
			const maxMessages = 100;
			const newMessages = [...currentMessages, message];
			const limitedMessages =
				newMessages.length > maxMessages
					? newMessages.slice(-maxMessages)
					: newMessages;

			return {
				...prev,
				[message.sessionRole === "navigator"
					? "navigatorMessages"
					: "driverMessages"]: limitedMessages,
			};
		});
	}, []);

	const updateActivity = useCallback((activity: string) => {
		setState((prev) => ({ ...prev, currentActivity: activity }));
	}, []);

	const setPhase = useCallback((phase: SessionPhase) => {
		setState((prev) => ({ ...prev, phase }));
	}, []);

	const setQuitState = useCallback((quitState: "normal" | "confirm") => {
		setState((prev) => ({ ...prev, quitState }));
	}, []);

	return {
		state,
		addMessage,
		updateActivity,
		setPhase,
		setQuitState,
	};
};
