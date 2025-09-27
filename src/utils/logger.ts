import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type LogLevel = "error" | "warn" | "info" | "debug" | "verbose";

/**
 * JSONL file logger for debugging Claude sessions
 * Controlled by LOG_LEVEL environment variable (error|warn|info|debug|verbose)
 * Disabled by default - set LOG_LEVEL=debug to enable all logging
 * Set LOG_LEVEL=verbose or use --verbose flag to log all agent communication
 */
export class Logger {
	private logFile: string;
	private logStream: fs.WriteStream | null = null;
	private logLevel: LogLevel | null;
	private mirrorToConsole = false;
	private verbose = false;

	constructor(filename: string = "pair-debug.log", verbose = false) {
		this.verbose = verbose;
		// Parse LOG_LEVEL environment variable
		const envLevel = process.env.LOG_LEVEL?.toLowerCase();
		// If verbose is enabled via CLI, set log level to verbose
		if (verbose) {
			this.logLevel = "verbose";
		} else if (
			["error", "warn", "info", "debug", "verbose"].includes(envLevel || "")
		) {
			this.logLevel = envLevel as LogLevel;
			// If environment sets verbose level, enable verbose mode
			if (envLevel === "verbose") {
				this.verbose = true;
			}
		} else {
			this.logLevel = null;
		}

		// Only initialize file logging if LOG_LEVEL is set
		if (this.logLevel) {
			const configuredPath = process.env.LOG_FILE;
			if (configuredPath) {
				// If LOG_FILE is absolute, use as-is; otherwise, place within default logs dir
				const isAbsolute = path.isAbsolute(configuredPath);
				const defaultDir = path.join(os.homedir(), ".pair", "logs");
				if (!fs.existsSync(defaultDir))
					fs.mkdirSync(defaultDir, { recursive: true });
				this.logFile = isAbsolute
					? configuredPath
					: path.join(defaultDir, configuredPath);
				const parentDir = path.dirname(this.logFile);
				if (!fs.existsSync(parentDir))
					fs.mkdirSync(parentDir, { recursive: true });
			} else {
				const logsDir = path.join(os.homedir(), ".pair", "logs");
				if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
				this.logFile = path.join(logsDir, filename);
			}

			// Create log file for JSONL output
			const timestamp = new Date().toISOString();
			this.logStream = fs.createWriteStream(this.logFile, { flags: "w" });
			// Write initial log entry in JSONL format
			this.writeJsonl({
				type: "SESSION_START",
				timestamp,
				level: this.logLevel.toUpperCase(),
				pid: process.pid,
				cwd: process.cwd(),
			});
		} else {
			this.logFile = "";
		}
	}

	private writeJsonl(data: any): void {
		if (!this.logStream) return;
		this.logStream.write(JSON.stringify(data) + "\n");
	}

	private shouldLog(level: LogLevel): boolean {
		if (!this.logLevel || !this.logStream) return false;

		const levels: LogLevel[] = ["error", "warn", "info", "debug", "verbose"];
		const currentLevelIndex = levels.indexOf(this.logLevel);
		const messageLevelIndex = levels.indexOf(level);

		return messageLevelIndex <= currentLevelIndex;
	}

	// biome-ignore lint/suspicious/noExplicitAny: Generic logging interface for flexibility
	logNavigatorSession(sessionId: string, message: any, context?: string) {
		// In verbose mode, log all session data; otherwise only at debug level
		const level = this.verbose ? "verbose" : "debug";
		if (!this.shouldLog(level) || !this.logStream) return;

		this.writeJsonl({
			timestamp: new Date().toISOString(),
			type: "NAVIGATOR_SESSION",
			sessionId,
			context,
			message: this.verbose ? message : this.truncateMessage(message),
		});
	}

	// biome-ignore lint/suspicious/noExplicitAny: Generic logging interface for flexibility
	logDriverSession(sessionId: string, message: any, context?: string) {
		// In verbose mode, log all session data; otherwise only at debug level
		const level = this.verbose ? "verbose" : "debug";
		if (!this.shouldLog(level) || !this.logStream) return;

		this.writeJsonl({
			timestamp: new Date().toISOString(),
			type: "DRIVER_SESSION",
			sessionId,
			context,
			message: this.verbose ? message : this.truncateMessage(message),
		});
	}

	// biome-ignore lint/suspicious/noExplicitAny: Generic logging interface for flexibility
	logEvent(event: string, data: any) {
		if (!this.shouldLog("info") || !this.logStream) return;

		this.writeJsonl({
			timestamp: new Date().toISOString(),
			type: "EVENT",
			event,
			data,
		});
	}

	// Enhanced tool logging with detailed information
	// biome-ignore lint/suspicious/noExplicitAny: Generic logging interface for flexibility
	logToolUse(actor: string, toolName: string, input: any, toolUseId?: string) {
		if (!this.shouldLog("info") || !this.logStream) return;

		this.writeJsonl({
			timestamp: new Date().toISOString(),
			type: "TOOL_USE",
			actor,
			toolName,
			toolUseId,
			input: this.verbose ? input : this.sanitizeToolInput(toolName, input),
		});
	}

	// Enhanced tool result logging
	// biome-ignore lint/suspicious/noExplicitAny: Generic logging interface for flexibility
	logToolResult(
		actor: string,
		toolName: string,
		toolUseId: string,
		result: any,
		isError?: boolean,
	) {
		if (!this.shouldLog("info") || !this.logStream) return;

		this.writeJsonl({
			timestamp: new Date().toISOString(),
			type: "TOOL_RESULT",
			actor,
			toolName,
			toolUseId,
			isError: isError || false,
			result: this.verbose
				? result
				: this.sanitizeToolResult(toolName, result, isError),
		});
	}

	// Track repeating events with bundling
	private eventBundles = new Map<
		string,
		{
			count: number;
			firstTimestamp: string;
			lastTimestamp: string;
			lastData?: any;
		}
	>();

	// biome-ignore lint/suspicious/noExplicitAny: Generic logging interface for flexibility
	logBundledEvent(
		eventKey: string,
		_event: string,
		data?: any,
		bundleWindowMs: number = 5000,
	) {
		if (!this.shouldLog("info") || !this.logStream) return;

		const now = new Date();
		const timestamp = now.toISOString();

		const existing = this.eventBundles.get(eventKey);
		if (existing) {
			const timeDiff =
				now.getTime() - new Date(existing.firstTimestamp).getTime();
			if (timeDiff < bundleWindowMs) {
				// Update bundle
				existing.count++;
				existing.lastTimestamp = timestamp;
				existing.lastData = data;
				return; // Don't log individual event
			} else {
				// Flush previous bundle and start new one
				this.flushEventBundle(eventKey);
			}
		}

		// Start new bundle
		this.eventBundles.set(eventKey, {
			count: 1,
			firstTimestamp: timestamp,
			lastTimestamp: timestamp,
			lastData: data,
		});

		// Set timer to flush bundle
		setTimeout(() => this.flushEventBundle(eventKey), bundleWindowMs);
	}

	private flushEventBundle(eventKey: string) {
		const bundle = this.eventBundles.get(eventKey);
		if (!bundle || !this.logStream) return;

		this.eventBundles.delete(eventKey);

		if (bundle.count === 1) {
			// Single event, log normally
			this.writeJsonl({
				timestamp: bundle.lastTimestamp,
				type: "EVENT",
				event: eventKey,
				data: bundle.lastData,
			});
		} else {
			// Bundled events
			const duration =
				new Date(bundle.lastTimestamp).getTime() -
				new Date(bundle.firstTimestamp).getTime();
			this.writeJsonl({
				timestamp: bundle.lastTimestamp,
				type: "EVENT_BUNDLE",
				event: eventKey,
				count: bundle.count,
				duration,
				firstTimestamp: bundle.firstTimestamp,
				lastData: bundle.lastData,
			});
		}
	}

	// Sanitize tool inputs to avoid logging sensitive data while keeping useful info
	// biome-ignore lint/suspicious/noExplicitAny: Generic logging interface for flexibility
	private sanitizeToolInput(toolName: string, input: any): any {
		if (!input) return input;

		const sanitized = { ...input };

		switch (toolName) {
			case "Read":
				return {
					file_path: input.file_path,
					offset: input.offset,
					limit: input.limit,
				};

			case "Edit":
			case "MultiEdit":
				return {
					file_path: input.file_path,
					old_string_preview:
						typeof input.old_string === "string"
							? input.old_string.substring(0, 100) +
								(input.old_string.length > 100 ? "..." : "")
							: input.old_string,
					new_string_preview:
						typeof input.new_string === "string"
							? input.new_string.substring(0, 100) +
								(input.new_string.length > 100 ? "..." : "")
							: input.new_string,
					replace_all: input.replace_all,
				};

			case "Write":
				return {
					file_path: input.file_path,
					content_length:
						typeof input.content === "string" ? input.content.length : 0,
					content_preview:
						typeof input.content === "string"
							? input.content.substring(0, 200) +
								(input.content.length > 200 ? "..." : "")
							: "[non-string content]",
				};

			case "Bash":
				return {
					command: input.command,
					description: input.description,
					timeout: input.timeout,
				};

			default: {
				// For other tools, return as-is but truncate long strings
				const result: any = {};
				for (const [key, value] of Object.entries(sanitized)) {
					if (typeof value === "string" && value.length > 500) {
						result[key] = `${value.substring(0, 500)}...`;
					} else {
						result[key] = value;
					}
				}
				return result;
			}
		}
	}

	// Sanitize tool results
	// biome-ignore lint/suspicious/noExplicitAny: Generic logging interface for flexibility
	private sanitizeToolResult(
		toolName: string,
		result: any,
		_isError?: boolean,
	): any {
		if (!result) return result;

		switch (toolName) {
			case "Read":
				if (typeof result === "string") {
					return {
						type: "file_content",
						length: result.length,
						lines: result.split("\n").length,
						preview:
							result.substring(0, 300) + (result.length > 300 ? "..." : ""),
					};
				}
				return result;

			case "Edit":
			case "MultiEdit":
			case "Write":
				if (typeof result === "string") {
					return {
						type: "operation_result",
						message:
							result.substring(0, 200) + (result.length > 200 ? "..." : ""),
					};
				}
				return result;

			case "Bash":
				if (typeof result === "string") {
					return {
						type: "command_output",
						length: result.length,
						preview:
							result.substring(0, 500) + (result.length > 500 ? "..." : ""),
					};
				}
				return result;

			case "Glob":
			case "Grep":
				if (Array.isArray(result)) {
					return {
						type: "search_results",
						count: result.length,
						results: result.slice(0, 10), // First 10 results
					};
				}
				return result;

			default:
				// Generic result handling
				if (typeof result === "string" && result.length > 1000) {
					return {
						type: "text_result",
						length: result.length,
						preview: `${result.substring(0, 1000)}...`,
					};
				}
				return result;
		}
	}

	// biome-ignore lint/suspicious/noExplicitAny: Generic logging interface for flexibility
	logStateChange(description: string, state: any) {
		if (!this.shouldLog("debug") || !this.logStream) return;

		this.writeJsonl({
			timestamp: new Date().toISOString(),
			type: "STATE_CHANGE",
			description,
			state,
		});
	}

	// Helper to truncate long messages when not in verbose mode
	private truncateMessage(message: any, maxLength = 500): any {
		const str = typeof message === "string" ? message : JSON.stringify(message);
		if (str.length <= maxLength) return message;
		return str.substring(0, maxLength) + "... (truncated)";
	}

	// Log agent communication in verbose mode
	// biome-ignore lint/suspicious/noExplicitAny: Generic logging interface for flexibility
	logAgentCommunication(
		from: string,
		to: string,
		messageType: string,
		data: any,
	) {
		if (!this.shouldLog("verbose") || !this.logStream) return;

		this.writeJsonl({
			timestamp: new Date().toISOString(),
			type: "AGENT_COMMUNICATION",
			from,
			to,
			messageType,
			data,
		});
	}

	getFilePath(): string | null {
		return this.logStream ? this.logFile : null;
	}

	close() {
		if (this.logStream) {
			this.logStream.end();
		}
	}
}
