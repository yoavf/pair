import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface LogEntry {
	timestamp: string;
	type:
		| "EVENT"
		| "EVENT_BUNDLE"
		| "TOOL_USE"
		| "TOOL_RESULT"
		| "NAVIGATOR"
		| "DRIVER"
		| "STATE";
	sessionId?: string;
	event?: string;
	description?: string;
	context?: string;
	data?: any;
	rawMessage?: any;
	// Enhanced tool fields
	actor?: string;
	toolName?: string;
	toolUseId?: string;
	isError?: boolean;
	bundleCount?: number;
	duration?: number;
}

interface SequenceEvent {
	timestamp: string;
	actor: "Architect" | "Navigator" | "Driver" | "System";
	action: string;
	details?: string;
	data?: any;
}

export class LogAnalyzer {
	private logFile: string;

	constructor(logFile?: string) {
		if (logFile) {
			this.logFile = logFile;
		} else {
			// Default to the standard log location
			this.logFile = path.join(os.homedir(), ".pair", "logs", "pair-debug.log");
		}
	}

	/**
	 * Parse the debug log file into structured entries
	 */
	parseLog(): LogEntry[] {
		if (!fs.existsSync(this.logFile)) {
			throw new Error(`Log file not found: ${this.logFile}`);
		}

		const content = fs.readFileSync(this.logFile, "utf-8");
		const lines = content.split("\n");
		const entries: LogEntry[] = [];
		let currentEntry: Partial<LogEntry> | null = null;
		let isCapturingData = false;
		let dataBuffer: string[] = [];

		for (const line of lines) {
			// Skip header lines and empty lines
			if (line.startsWith("===") || line.trim() === "") continue;

			// Check if this is a new log entry
			const eventMatch = line.match(/^EVENT \[([^\]]+)\] (.+)$/);
			const eventBundleMatch = line.match(/^EVENT_BUNDLE \[([^\]]+)\] (.+)$/);
			const toolUseMatch = line.match(/^TOOL_USE \[([^\]]+)\] (.+)$/);
			const toolResultMatch = line.match(/^TOOL_RESULT \[([^\]]+)\] (.+)$/);
			const navigatorMatch = line.match(/^NAVIGATOR \[([^\]]+)\] (.+)$/);
			const driverMatch = line.match(/^DRIVER \[([^\]]+)\] (.+)$/);
			const stateMatch = line.match(/^STATE \[([^\]]+)\] (.+)$/);

			if (
				eventMatch ||
				eventBundleMatch ||
				toolUseMatch ||
				toolResultMatch ||
				navigatorMatch ||
				driverMatch ||
				stateMatch
			) {
				// Save the previous entry if it exists
				if (currentEntry) {
					if (dataBuffer.length > 0) {
						try {
							currentEntry.data = JSON.parse(dataBuffer.join("\n"));
						} catch {
							currentEntry.data = dataBuffer.join("\n");
						}
					}
					entries.push(currentEntry as LogEntry);
				}

				// Start new entry
				currentEntry = {};
				dataBuffer = [];
				isCapturingData = false;

				if (eventMatch) {
					currentEntry.type = "EVENT";
					currentEntry.timestamp = eventMatch[1];
					currentEntry.event = eventMatch[2];
				} else if (eventBundleMatch) {
					currentEntry.type = "EVENT_BUNDLE";
					currentEntry.timestamp = eventBundleMatch[1];
					currentEntry.event = eventBundleMatch[2];
				} else if (toolUseMatch) {
					currentEntry.type = "TOOL_USE";
					currentEntry.timestamp = toolUseMatch[1];
					currentEntry.actor = toolUseMatch[2];
				} else if (toolResultMatch) {
					currentEntry.type = "TOOL_RESULT";
					currentEntry.timestamp = toolResultMatch[1];
					currentEntry.actor = toolResultMatch[2];
				} else if (navigatorMatch) {
					currentEntry.type = "NAVIGATOR";
					currentEntry.timestamp = navigatorMatch[1];
					currentEntry.sessionId = navigatorMatch[2];
				} else if (driverMatch) {
					currentEntry.type = "DRIVER";
					currentEntry.timestamp = driverMatch[1];
					currentEntry.sessionId = driverMatch[2];
				} else if (stateMatch) {
					currentEntry.type = "STATE";
					currentEntry.timestamp = stateMatch[1];
					currentEntry.description = stateMatch[2];
				}
			} else if (line.startsWith("Context: ") && currentEntry) {
				currentEntry.context = line.substring(9);
			} else if (
				line.startsWith("Tool: ") &&
				currentEntry &&
				(currentEntry.type === "TOOL_USE" ||
					currentEntry.type === "TOOL_RESULT")
			) {
				currentEntry.toolName = line.substring(6);
			} else if (
				line.startsWith("ID: ") &&
				currentEntry &&
				(currentEntry.type === "TOOL_USE" ||
					currentEntry.type === "TOOL_RESULT")
			) {
				currentEntry.toolUseId = line.substring(4);
			} else if (
				line.startsWith("Status: ") &&
				currentEntry &&
				currentEntry.type === "TOOL_RESULT"
			) {
				currentEntry.isError = line.substring(8) === "ERROR";
			} else if (
				line.startsWith("Count: ") &&
				currentEntry &&
				currentEntry.type === "EVENT_BUNDLE"
			) {
				const match = line.match(/Count: (\d+) events/);
				if (match) currentEntry.bundleCount = parseInt(match[1], 10);
			} else if (
				line.startsWith("Duration: ") &&
				currentEntry &&
				currentEntry.type === "EVENT_BUNDLE"
			) {
				const match = line.match(/Duration: (\d+)ms/);
				if (match) currentEntry.duration = parseInt(match[1], 10);
			} else if (
				line === "Data:" ||
				line === "Raw Message:" ||
				line === "State:" ||
				line === "Input:" ||
				line === "Result:" ||
				line === "Last Data:"
			) {
				isCapturingData = true;
			} else if (
				line ===
				"================================================================================"
			) {
				isCapturingData = false;
			} else if (isCapturingData) {
				dataBuffer.push(line);
			}
		}

		// Don't forget the last entry
		if (currentEntry) {
			if (dataBuffer.length > 0) {
				try {
					currentEntry.data = JSON.parse(dataBuffer.join("\n"));
				} catch {
					currentEntry.data = dataBuffer.join("\n");
				}
			}
			entries.push(currentEntry as LogEntry);
		}

		return entries;
	}

	/**
	 * Convert log entries to sequence events for visualization
	 */
	toSequenceEvents(entries?: LogEntry[]): SequenceEvent[] {
		const logEntries = entries || this.parseLog();
		const sequenceEvents: SequenceEvent[] = [];

		for (const entry of logEntries) {
			let actor: SequenceEvent["actor"] = "System";
			let action = "";
			let details = "";

			switch (entry.type) {
				case "TOOL_USE":
					actor = this.capitalizeActor(entry.actor);
					action = `🔧 ${entry.toolName}`;
					details = this.formatToolInput(entry.toolName, entry.data);
					break;

				case "TOOL_RESULT": {
					actor = this.capitalizeActor(entry.actor);
					const status = entry.isError ? "❌ ERROR" : "✅ SUCCESS";
					action = `📤 ${entry.toolName} → ${status}`;
					details = this.formatToolResult(
						entry.toolName,
						entry.data,
						entry.isError,
					);
					break;
				}

				case "EVENT_BUNDLE":
					actor = "System";
					action = `📦 ${entry.event} (×${entry.bundleCount})`;
					details = entry.duration ? `${entry.duration}ms` : "";
					break;

				case "EVENT":
					if (entry.event?.includes("ARCHITECT")) {
						actor = "Architect";
						if (entry.event.includes("PLAN_CREATED")) {
							action = "Creates plan";
							details = `Plan length: ${entry.data?.planLength} chars, ${entry.data?.turnCount} turns`;
						} else {
							action = entry.event
								.replace("ARCHITECT_", "")
								.toLowerCase()
								.replace(/_/g, " ");
						}
					} else if (entry.event?.includes("NAVIGATOR")) {
						actor = "Navigator";
						if (entry.event.includes("INITIALIZING")) {
							action = "Initializing";
							details = `Task: ${entry.data?.taskLength} chars, Plan: ${entry.data?.planLength} chars`;
						} else {
							action = entry.event
								.replace("NAVIGATOR_", "")
								.toLowerCase()
								.replace(/_/g, " ");
						}
					} else if (entry.event?.includes("DRIVER")) {
						actor = "Driver";
						if (entry.event.includes("INITIALIZING")) {
							action = "Initializing";
						} else {
							action = entry.event
								.replace("DRIVER_", "")
								.toLowerCase()
								.replace(/_/g, " ");
						}
					} else {
						actor = "System";
						action =
							entry.event?.toLowerCase().replace(/_/g, " ") || "unknown event";
					}
					break;

				case "NAVIGATOR":
					actor = "Navigator";
					action = "Session message";
					details = entry.context || "";
					break;

				case "DRIVER":
					actor = "Driver";
					action = "Session message";
					details = entry.context || "";
					break;

				case "STATE":
					actor = "System";
					action = "State change";
					details = entry.description || "";
					break;
			}

			if (action) {
				sequenceEvents.push({
					timestamp: entry.timestamp,
					actor,
					action,
					details,
					data: entry.data,
				});
			}
		}

		return this.deduplicateConsecutiveEvents(sequenceEvents);
	}

	/**
	 * Deduplicate consecutive identical events, replacing with a count
	 */
	private deduplicateConsecutiveEvents(
		events: SequenceEvent[],
	): SequenceEvent[] {
		if (events.length === 0) return events;

		const deduplicated: SequenceEvent[] = [];
		let i = 0;

		while (i < events.length) {
			const currentEvent = events[i];
			let count = 1;

			// Check if this event should be deduplicated
			const isDuplicatable = this.isDuplicatableEvent(currentEvent.action);

			if (isDuplicatable) {
				// Count consecutive identical events
				while (
					i + count < events.length &&
					this.eventsAreIdentical(currentEvent, events[i + count])
				) {
					count++;
				}

				if (count > 1) {
					// Create a deduplicated event
					const deduplicatedEvent: SequenceEvent = {
						...currentEvent,
						action: `${currentEvent.action} (×${count})`,
						details: `${count} consecutive iterations`,
					};
					deduplicated.push(deduplicatedEvent);
				} else {
					deduplicated.push(currentEvent);
				}
			} else {
				deduplicated.push(currentEvent);
			}

			i += count;
		}

		return deduplicated;
	}

	/**
	 * Check if an event type should be deduplicated
	 */
	private isDuplicatableEvent(action: string): boolean {
		const duplicatablePatterns = [
			"implementation loop iteration",
			"mcp sse post",
			"continuing with prompt",
			"intermediate batch",
			"tool result observed",
			"tool pending",
		];

		return duplicatablePatterns.some((pattern) => action.includes(pattern));
	}

	/**
	 * Check if two events are identical for deduplication purposes
	 */
	private eventsAreIdentical(
		event1: SequenceEvent,
		event2: SequenceEvent,
	): boolean {
		// For basic deduplication, just check if the action is the same
		// Could be extended to check actor, details, etc. if needed
		return event1.action === event2.action && event1.actor === event2.actor;
	}

	/**
	 * Generate a simple text-based sequence diagram
	 */
	generateTextSequenceDiagram(
		events?: SequenceEvent[],
		includeArchitect?: boolean,
	): string {
		const sequenceEvents = events || this.toSequenceEvents();

		if (sequenceEvents.length === 0) {
			return "No events found in log file.";
		}

		// Filter out Architect events by default and reorder
		const filteredEvents = includeArchitect
			? sequenceEvents
			: sequenceEvents.filter((event) => event.actor !== "Architect");
		const actors = includeArchitect
			? ["Driver", "System", "Navigator", "Architect"]
			: ["Driver", "System", "Navigator"];
		const maxActorLength = Math.max(...actors.map((a) => a.length));
		const header = actors
			.map((actor) => actor.padEnd(maxActorLength))
			.join(" | ");
		const separator = actors.map(() => "-".repeat(maxActorLength)).join("-+-");

		let diagram = `\n${header}\n${separator}\n`;

		for (const event of filteredEvents) {
			const time = new Date(event.timestamp).toLocaleTimeString();
			const actorIndex = actors.indexOf(event.actor);

			let line = "";
			for (let i = 0; i < actors.length; i++) {
				if (i === actorIndex) {
					const text = `${event.action}`;
					line += text.padEnd(maxActorLength);
				} else {
					line += " ".repeat(maxActorLength);
				}
				if (i < actors.length - 1) line += " | ";
			}

			line += ` [${time}]`;
			if (event.details) {
				line += ` - ${event.details}`;
			}

			diagram += `${line}\n`;
		}

		return diagram;
	}

	/**
	 * Generate a Mermaid sequence diagram
	 */
	generateMermaidSequenceDiagram(
		events?: SequenceEvent[],
		includeArchitect?: boolean,
	): string {
		const sequenceEvents = events || this.toSequenceEvents();

		if (sequenceEvents.length === 0) {
			return "sequenceDiagram\n    Note over System: No events found";
		}

		// Filter out Architect events by default
		const filteredEvents = includeArchitect
			? sequenceEvents
			: sequenceEvents.filter((event) => event.actor !== "Architect");

		let mermaid = "sequenceDiagram\n";
		mermaid += "    participant D as Driver\n";
		mermaid += "    participant S as System\n";
		mermaid += "    participant N as Navigator\n";
		if (includeArchitect) {
			mermaid += "    participant A as Architect\n";
		}
		mermaid += "\n";

		let previousActor: string | null = null;

		for (const event of filteredEvents) {
			const actorCode = event.actor[0]; // S, N, D
			const timestamp = new Date(event.timestamp).toLocaleTimeString();

			// Show self-interaction or note
			if (event.actor === previousActor) {
				mermaid += `    ${actorCode}->>${actorCode}: ${event.action}\n`;
			} else {
				mermaid += `    Note over ${actorCode}: ${timestamp} - ${event.action}\n`;
			}

			if (event.details) {
				mermaid += `    Note right of ${actorCode}: ${event.details.substring(0, 50)}${event.details.length > 50 ? "..." : ""}\n`;
			}

			previousActor = event.actor;
		}

		return mermaid;
	}

	/**
	 * Filter events by actor
	 */
	filterByActor(
		actor: SequenceEvent["actor"],
		events?: SequenceEvent[],
	): SequenceEvent[] {
		const sequenceEvents = events || this.toSequenceEvents();
		return sequenceEvents.filter((event) => event.actor === actor);
	}

	/**
	 * Filter events by time range
	 */
	filterByTimeRange(
		startTime: Date,
		endTime: Date,
		events?: SequenceEvent[],
	): SequenceEvent[] {
		const sequenceEvents = events || this.toSequenceEvents();
		return sequenceEvents.filter((event) => {
			const eventTime = new Date(event.timestamp);
			return eventTime >= startTime && eventTime <= endTime;
		});
	}

	// Helper methods for formatting
	private capitalizeActor(actor?: string): SequenceEvent["actor"] {
		if (!actor) return "System";
		const normalized = actor.toLowerCase();
		switch (normalized) {
			case "architect":
				return "Architect";
			case "navigator":
				return "Navigator";
			case "driver":
				return "Driver";
			default:
				return "System";
		}
	}

	// biome-ignore lint/suspicious/noExplicitAny: Generic tool data handling
	private formatToolInput(toolName?: string, data?: any): string {
		if (!data || !toolName) return "";

		switch (toolName) {
			case "Read": {
				const filePath = data.file_path
					? path.basename(data.file_path)
					: "unknown";
				return `📁 ${filePath}${data.offset ? ` (offset ${data.offset})` : ""}`;
			}
			case "Edit":
			case "MultiEdit": {
				const editFile = data.file_path
					? path.basename(data.file_path)
					: "unknown";
				return `📝 ${editFile}`;
			}
			case "Write": {
				const writeFile = data.file_path
					? path.basename(data.file_path)
					: "unknown";
				return `📝 ${writeFile} (${data.content_length || 0} chars)`;
			}
			case "Bash":
				return `💻 ${data.command || "unknown command"}`;
			case "BashOutput":
				return `📊 bash ${data.bash_id || "unknown"}`;
			case "Glob":
				return `🔍 ${data.pattern || "unknown pattern"}`;
			case "Grep":
				return `🔎 "${data.pattern || "unknown"}"${data.glob ? ` in ${data.glob}` : ""}`;
			case "TodoWrite": {
				const todoCount = Array.isArray(data.todos) ? data.todos.length : 0;
				return `✅ ${todoCount} todos`;
			}
			default: {
				// For MCP tools, show the first few parameters
				const keys = Object.keys(data).slice(0, 3);
				if (keys.length > 0) {
					return keys.join(", ");
				}
				return "";
			}
		}
	}

	// biome-ignore lint/suspicious/noExplicitAny: Generic tool result handling
	private formatToolResult(
		toolName?: string,
		data?: any,
		isError?: boolean,
	): string {
		if (isError) {
			return data?.message || data?.text || "Error occurred";
		}

		if (!data || !toolName) return "";

		switch (toolName) {
			case "Read":
				if (data.type === "file_content") {
					return `${data.lines || 0} lines, ${data.length || 0} chars`;
				}
				return "";
			case "Edit":
			case "MultiEdit":
				if (data.type === "operation_result") {
					// Extract meaningful info from edit results
					if (data.message?.includes("updated")) {
						return "File updated";
					}
					return data.message || "Modified successfully";
				}
				return "Success";
			case "Write":
				if (data.type === "operation_result") {
					return "File written";
				}
				return "Success";
			case "Bash":
				if (data.type === "command_output") {
					return `${data.length || 0} chars output`;
				}
				if (typeof data === "string" && data.includes("background with ID:")) {
					const match = data.match(/background with ID: (\w+)/);
					return match ? `Started (${match[1]})` : "Started in background";
				}
				return "Command executed";
			case "BashOutput":
				if (
					typeof data === "string" &&
					data.includes("<status>completed</status>")
				) {
					if (data.includes("EADDRINUSE")) {
						return "Port already in use";
					}
					return "Command completed";
				}
				return "Output retrieved";
			case "TodoWrite":
				return "Todos updated";
			case "Glob":
			case "Grep":
				if (data.type === "search_results") {
					return `${data.count || 0} matches`;
				}
				return "";
			default:
				if (data.type === "text_result") {
					return `${data.length || 0} chars`;
				}
				return "Success";
		}
	}
}
