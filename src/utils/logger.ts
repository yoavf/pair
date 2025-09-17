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
	private mirrorToConsole = false;

	constructor(filename: string = "claude-pair-debug.log") {
		// Parse LOG_LEVEL environment variable
		const envLevel = process.env.LOG_LEVEL?.toLowerCase();
		this.logLevel = ["error", "warn", "info", "debug"].includes(envLevel || "")
			? (envLevel as LogLevel)
			: null;

		// Only initialize file logging if LOG_LEVEL is set
		if (this.logLevel) {
			const configuredPath = process.env.LOG_FILE;
			if (configuredPath) {
				// If LOG_FILE is absolute, use as-is; otherwise, place within default logs dir
				const isAbsolute = path.isAbsolute(configuredPath);
				const defaultDir = path.join(os.homedir(), ".claude-pair", "logs");
				if (!fs.existsSync(defaultDir))
					fs.mkdirSync(defaultDir, { recursive: true });
				this.logFile = isAbsolute
					? configuredPath
					: path.join(defaultDir, configuredPath);
				const parentDir = path.dirname(this.logFile);
				if (!fs.existsSync(parentDir))
					fs.mkdirSync(parentDir, { recursive: true });
			} else {
				const logsDir = path.join(os.homedir(), ".claude-pair", "logs");
				if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
				this.logFile = path.join(logsDir, filename);
			}

			// Create log file with timestamp header
			const timestamp = new Date().toISOString();
			this.logStream = fs.createWriteStream(this.logFile, { flags: "w" });
			const header = [
				`=== Claude Pair Programming Debug Log - ${timestamp} ===`,
				`=== Log Level: ${this.logLevel.toUpperCase()} ===`,
				`=== PID: ${process.pid} CWD: ${process.cwd()} ===`,
				"",
			].join("\n");
			this.logStream.write(header);
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

		const lines = [
			`NAVIGATOR [${entry.timestamp}] ${sessionId}`,
			context ? `Context: ${context}` : undefined,
			`Raw Message:`,
			entry.message,
			`${"=".repeat(80)}`,
			"",
		].filter(Boolean) as string[];
		const output = lines.join("\n");
		this.logStream.write(output);
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

		const lines = [
			`DRIVER [${entry.timestamp}] ${sessionId}`,
			context ? `Context: ${context}` : undefined,
			`Raw Message:`,
			entry.message,
			`${"=".repeat(80)}`,
			"",
		].filter(Boolean) as string[];
		const output = lines.join("\n");
		this.logStream.write(output);
	}

	// biome-ignore lint/suspicious/noExplicitAny: Generic logging interface for flexibility
	logEvent(event: string, data: any) {
		if (!this.shouldLog("info") || !this.logStream) return;

		const entry = {
			timestamp: new Date().toISOString(),
			event,
			data: JSON.stringify(data, null, 2),
		};

		const lines = [
			`EVENT [${entry.timestamp}] ${event}`,
			`Data:`,
			entry.data,
			`${"=".repeat(80)}`,
			"",
		];
		const output = lines.join("\n");
		this.logStream.write(output);
	}

	// biome-ignore lint/suspicious/noExplicitAny: Generic logging interface for flexibility
	logStateChange(description: string, state: any) {
		if (!this.shouldLog("debug") || !this.logStream) return;

		const entry = {
			timestamp: new Date().toISOString(),
			description,
			state: JSON.stringify(state, null, 2),
		};

		const lines = [
			`STATE [${entry.timestamp}] ${description}`,
			`State:`,
			entry.state,
			`${"=".repeat(80)}`,
			"",
		];
		const output = lines.join("\n");
		this.logStream.write(output);
		if (this.mirrorToConsole) console.log(output);
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
