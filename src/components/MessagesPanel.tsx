import { Box } from "ink";
import type React from "react";
import type { Message } from "../types.js";
import DriverPane from "./DriverPane.js";
import NavigatorPane from "./NavigatorPane.js";

interface Props {
	navigatorMessages: Message[];
	driverMessages: Message[];
}

const MessagesPanel: React.FC<Props> = ({
	navigatorMessages,
	driverMessages,
}) => {
	return (
		<Box height="100%" flexDirection="row">
			<Box flexGrow={1} marginRight={1}>
				<NavigatorPane messages={navigatorMessages} />
			</Box>

			<Box flexGrow={1}>
				<DriverPane messages={driverMessages} />
			</Box>
		</Box>
	);
};

export default MessagesPanel;
