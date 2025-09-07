import { Box, Text } from "ink";
import type React from "react";
import { Component, type ReactNode } from "react";

interface Props {
	children: ReactNode;
}

interface State {
	hasError: boolean;
	error?: Error;
}

/**
 * Error boundary component to catch and handle React component errors gracefully
 */
export class ErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(error: Error): State {
		return {
			hasError: true,
			error,
		};
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		console.error("React component error:", error);
		console.error("Error info:", errorInfo);
	}

	render() {
		if (this.state.hasError) {
			return (
				<Box flexDirection="column" padding={2}>
					<Box borderStyle="double" borderColor="red" padding={1}>
						<Text bold color="red">
							❌ Application Error
						</Text>
					</Box>

					<Box marginTop={1}>
						<Text>An unexpected error occurred in the interface:</Text>
					</Box>

					{this.state.error && (
						<Box marginTop={1}>
							<Text color="red">{this.state.error.message}</Text>
						</Box>
					)}

					<Box marginTop={1}>
						<Text dimColor>
							Press Ctrl+C to exit and restart the application
						</Text>
					</Box>
				</Box>
			);
		}

		return this.props.children;
	}
}

export default ErrorBoundary;
