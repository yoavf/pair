import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type LogLevel = "error" | "warn" | "info" | "debug";

/**
 * Simple file logger for debugging Claude sessions
 * Controlled by LOG_LEVEL environment variable (error|warn|info|debug)
 * Disabled by default - set LOG_LEVEL=debug to enable all logging
 */
export class Logger {
	private logFile: string;
	private logStream: fs.WriteStream | null = null;
	private logLevel: LogLevel | null;

	constructor(filename: string = "claude-pair-debug.log") {
		// Parse LOG_LEVEL environment variable
		const envLevel = process.env.LOG_LEVEL?.toLowerCase();
		this.logLevel = ["error", "warn", "info", "debug"].includes(envLevel || "")
			? (envLevel as LogLevel)
			: null;

		// Only initialize file logging if LOG_LEVEL is set
		if (this.logLevel) {
			const logsDir = path.join(os.homedir(), ".claude-pair", "logs");

			// Ensure logs directory exists
			if (!fs.existsSync(logsDir)) {
				fs.mkdirSync(logsDir, { recursive: true });
			}

			this.logFile = path.join(logsDir, filename);

			// Create log file with timestamp header
			const timestamp = new Date().toISOString();
			this.logStream = fs.createWriteStream(this.logFile, { flags: "w" });
			this.logStream.write(
				`=== Claude Pair Programming Debug Log - ${timestamp} ===\n`,
			);
			this.logStream.write(
				`=== Log Level: ${this.logLevel.toUpperCase()} ===\n\n`,
			);
		} else {
			this.logFile = "";
		}
	}

	private shouldLog(level: LogLevel): boolean {
		if (!this.logLevel || !this.logStream) return false;

		const levels: LogLevel[] = ["error", "warn", "info", "debug"];
		const currentLevelIndex = levels.indexOf(this.logLevel);
		const messageLevelIndex = levels.indexOf(level);

		return messageLevelIndex <= currentLevelIndex;
	}

	// biome-ignore lint/suspicious/noExplicitAny: Generic logging interface for flexibility
	logNavigatorSession(sessionId: string, message: any, context?: string) {
		if (!this.shouldLog("debug") || !this.logStream) return;

		const entry = {
			timestamp: new Date().toISOString(),
			type: "NAVIGATOR_SESSION",
			sessionId,
			context,
			message: JSON.stringify(message, null, 2),
		};

		this.logStream.write(`NAVIGATOR [${entry.timestamp}] ${sessionId}\n`);
		if (context) {
			this.logStream.write(`Context: ${context}\n`);
		}
		this.logStream.write(`Raw Message:\n${entry.message}\n`);
		this.logStream.write(`${"=".repeat(80)}\n\n`);
	}

	// biome-ignore lint/suspicious/noExplicitAny: Generic logging interface for flexibility
	logDriverSession(sessionId: string, message: any, context?: string) {
		if (!this.shouldLog("debug") || !this.logStream) return;

		const entry = {
			timestamp: new Date().toISOString(),
			type: "DRIVER_SESSION",
			sessionId,
			context,
			message: JSON.stringify(message, null, 2),
		};

		this.logStream.write(`DRIVER [${entry.timestamp}] ${sessionId}\n`);
		if (context) {
			this.logStream.write(`Context: ${context}\n`);
		}
		this.logStream.write(`Raw Message:\n${entry.message}\n`);
		this.logStream.write(`${"=".repeat(80)}\n\n`);
	}

	// biome-ignore lint/suspicious/noExplicitAny: Generic logging interface for flexibility
	logEvent(event: string, data: any) {
		if (!this.shouldLog("info") || !this.logStream) return;

		const entry = {
			timestamp: new Date().toISOString(),
			event,
			data: JSON.stringify(data, null, 2),
		};

		this.logStream.write(`EVENT [${entry.timestamp}] ${event}\n`);
		this.logStream.write(`Data:\n${entry.data}\n`);
		this.logStream.write(`${"=".repeat(80)}\n\n`);
	}

	// biome-ignore lint/suspicious/noExplicitAny: Generic logging interface for flexibility
	logStateChange(description: string, state: any) {
		if (!this.shouldLog("debug") || !this.logStream) return;

		const entry = {
			timestamp: new Date().toISOString(),
			description,
			state: JSON.stringify(state, null, 2),
		};

		this.logStream.write(`STATE [${entry.timestamp}] ${description}\n`);
		this.logStream.write(`State:\n${entry.state}\n`);
		this.logStream.write(`${"=".repeat(80)}\n\n`);
	}

	close() {
		if (this.logStream) {
			this.logStream.end();
		}
	}
}
