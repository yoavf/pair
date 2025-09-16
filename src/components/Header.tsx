import { Box, Text } from "ink";
import type React from "react";
import Markdown from "./Markdown.js";

interface Props {
	projectPath: string;
	initialTask: string;
}

const Header: React.FC<Props> = ({ projectPath, initialTask }) => {
	return (
		<Box flexDirection="column" marginBottom={1}>
			<Box justifyContent="flex-start" marginTop={1}>
				<Text dimColor>Project: {projectPath}</Text>
			</Box>

			<Box marginTop={1} flexDirection="column">
				<Text bold>Task:</Text>
			</Box>

			<Box
				marginTop={1}
				marginX={2}
				paddingY={1}
				paddingX={2}
				borderStyle="round"
				borderColor="gray"
			>
				<Markdown>{initialTask}</Markdown>
			</Box>
		</Box>
	);
};

export default Header;
