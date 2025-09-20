#!/usr/bin/env tsx

import { render } from "ink";
import { Box, Text } from "ink";
import React from "react";
import ToolMessage from "../src/components/ToolMessage.js";
import DriverMessage from "../src/components/DriverMessage.js";
import SystemMessage from "../src/components/SystemMessage.js";
import type { Message } from "../src/types.js";

const UIPreview: React.FC = () => {
	const separator = "-".repeat(60);

	const driverMessage: Message = {
		role: "assistant",
		content: "I can see the logout section from line 254-260 in the Hebrew file as well. Now let me run the tests to verify everything is working correctly and do this or that",
		timestamp: new Date(),
		sessionRole: "driver",
	};

	const driverMessageLong: Message = {
		role: "assistant",
		content: "Great! All tests are passing. Now let me run the lint command to check for any linting issues:\n\nI'll also check the package.json for any script configurations that might be relevant.",
		timestamp: new Date(),
		sessionRole: "driver",
	};

	const navigatorReaction: Message = {
		role: "assistant",
		content: "Looks good to me! The implementation matches our requirements perfectly.",
		timestamp: new Date(),
		sessionRole: "navigator",
	};

	const transitionMessage: Message = {
		role: "system",
		content: "🚀 Starting pair coding session to implement the plan...",
		timestamp: new Date(),
		sessionRole: "driver",
		symbol: "",
	};

	const planMessage: Message = {
		role: "system",
		content: "📋 PLAN CREATED:\n\n1. Update UI components for better design\n2. Fix timestamp display logic\n3. Improve threading symbols",
		timestamp: new Date(),
		sessionRole: "navigator",
	};

	return (
		<Box flexDirection="column" padding={2}>
			<Text bold color="cyan">
				🎨 Pair - UI Design Preview
			</Text>
			<Text dimColor>Showcasing all message types and variations</Text>

			<Box marginY={1}>
				<Text color="yellow">═══ Driver Messages ═══</Text>
			</Box>

			<Box flexDirection="column" marginBottom={2}>
				<Text dimColor>Driver message (no timestamp):</Text>
				<DriverMessage
					message={driverMessage}
					reactions={[]}
					showTimestamp={false}
					shortTime=""
					entryKey="preview-driver-1"
					driverWidth={84}
					separator={separator}
				/>
			</Box>

			<Box flexDirection="column" marginBottom={2}>
				<Text dimColor>Driver message with timestamp:</Text>
				<Box justifyContent="flex-start" marginTop={2} marginBottom={1}>
					<Text dimColor>16:59</Text>
				</Box>
				<DriverMessage
					message={driverMessageLong}
					reactions={[]}
					showTimestamp={false}
					shortTime=""
					entryKey="preview-driver-2"
					driverWidth={84}
					separator={separator}
				/>
			</Box>

			<Box flexDirection="column" marginBottom={2}>
				<Text dimColor>Driver message with navigator reaction:</Text>
				<DriverMessage
					message={driverMessage}
					reactions={[navigatorReaction]}
					showTimestamp={false}
					shortTime=""
					entryKey="preview-driver-3"
					driverWidth={84}
					separator={separator}
				/>
			</Box>

			<Box marginY={1}>
				<Text color="yellow">═══ System Messages ═══</Text>
			</Box>

			<Box flexDirection="column" marginBottom={2}>
				<Text dimColor>Transition message (no ⏺ symbol):</Text>
				<SystemMessage
					message={transitionMessage}
					isPlanning={false}
					entryKey="preview-transition"
					driverWidth={84}
					systemWidth={88}
				/>
			</Box>

			<Box flexDirection="column" marginBottom={2}>
				<Text dimColor>Plan message:</Text>
				<SystemMessage
					message={planMessage}
					isPlanning={true}
					entryKey="preview-plan"
					driverWidth={84}
					systemWidth={88}
				/>
			</Box>

			<Box marginY={1}>
				<Text color="yellow">═══ Navigator Tool Messages ═══</Text>
			</Box>

			<Box flexDirection="column" marginBottom={2}>
				<Text dimColor>Navigator approval (bright green ✓):</Text>
				<Box paddingLeft={2}>
					<ToolMessage
						content="Approved: Perfect - server action matches the plan exactly with correct use server directive, auth import, and redirect path"
						color="gray"
						sessionRole="navigator"
						symbol="✓"
						symbolColor="#00ff00"
					/>
				</Box>
			</Box>

			<Box flexDirection="column" marginBottom={2}>
				<Text dimColor>Navigator denial (bright red x):</Text>
				<Box paddingLeft={2}>
					<ToolMessage
						content="Denied: Missing error handling and validation for the authentication flow. Please add proper error boundaries."
						color="gray"
						sessionRole="navigator"
						symbol="x"
						symbolColor="#ff0000"
					/>
				</Box>
			</Box>

			<Box flexDirection="column" marginBottom={2}>
				<Text dimColor>Navigator code review:</Text>
				<Box paddingLeft={2}>
					<ToolMessage
						content="Code Review: The implementation looks good but could benefit from additional comments explaining the authentication flow"
						color="gray"
						sessionRole="navigator"
						symbol="•"
						symbolColor="cyan"
					/>
				</Box>
			</Box>

			<Box flexDirection="column" marginBottom={2}>
				<Text dimColor>Navigator complete:</Text>
				<Box paddingLeft={2}>
					<ToolMessage
						content="Completed: All authentication features have been successfully implemented with proper error handling and validation"
						color="gray"
						sessionRole="navigator"
						symbol="⏹"
						symbolColor="#00ff00"
					/>
				</Box>
			</Box>

			<Box marginY={1}>
				<Text color="yellow">═══ Driver Tool Messages ═══</Text>
			</Box>

			<Box flexDirection="column" marginBottom={2}>
				<Text dimColor>Driver tool (Read):</Text>
				<Box paddingLeft={2}>
					<ToolMessage
						content="Read - frontend/src/components/AuthForm.tsx"
						color="gray"
						sessionRole="driver"
					/>
				</Box>
			</Box>

			<Box flexDirection="column" marginBottom={2}>
				<Text dimColor>Driver review request:</Text>
				<Box paddingLeft={2}>
					<ToolMessage
						content="🔍 Review requested: Implementation complete, please verify the authentication flow"
						color="gray"
						sessionRole="driver"
						symbol=""
					/>
				</Box>
			</Box>

		</Box>
	);
};

console.clear();
render(<UIPreview />);