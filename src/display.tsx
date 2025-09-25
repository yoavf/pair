import path from "node:path";
import { render } from "ink";
import type React from "react";
import { useEffect } from "react";
import ErrorBoundary from "./components/ErrorBoundary.js";
import PairProgrammingApp from "./components/PairProgrammingApp.js";
import { useMessages } from "./hooks/useMessages.js";
import type { Message, Role, SessionPhase } from "./types.js";
import type { AppConfig } from "./utils/config.js";
import { formatSystemLine } from "./utils/systemLine.js";

interface Props {
	projectPath: string;
	initialTask: string;
	onExit: () => void;
}

const _InkApp: React.FC<Props> = ({ projectPath, initialTask, onExit }) => {
	// Default models configuration for standalone usage
	const defaultModels = {
		architect: { provider: "claude-code", model: "opus-4.1" },
		navigator: { provider: "claude-code", model: undefined },
		driver: { provider: "claude-code", model: undefined },
	};
	const { state } = useMessages(
		projectPath,
		initialTask,
		undefined,
		defaultModels,
	);

	return <PairProgrammingApp state={state} onExit={onExit} />;
};

export class InkDisplayManager {
	// biome-ignore lint/suspicious/noExplicitAny: Ink render instance type
	private app: any;
	private addMessage?: (message: Message) => void;
	private updateActivity?: (activity: string) => void;
	// Removed role switching/time remaining helpers
	private setPhaseFn?: (phase: SessionPhase) => void;
	private setQuitStateFn?: (quitState: "normal" | "confirm") => void;
	private currentPhase?: SessionPhase;
	private firstCtrlCPressed = false;
	private confirmExitTimer?: NodeJS.Timeout;
	private syncTicker?: NodeJS.Timeout;
	private config!: AppConfig;
	private projectPath: string = process.cwd();

	start(
		projectPath: string,
		initialTask: string,
		config: AppConfig,
		onExit: () => void,
	) {
		this.config = config;
		this.projectPath = projectPath;

		// Create a wrapper component that exposes the hooks
		const AppWrapper: React.FC = () => {
			const providers = {
				architect: config.architectConfig.provider,
				navigator: config.navigatorConfig.provider,
				driver: config.driverConfig.provider,
			};
			const models = {
				architect: config.architectConfig,
				navigator: config.navigatorConfig,
				driver: config.driverConfig,
			};
			const { state, addMessage, updateActivity, setPhase, setQuitState } =
				useMessages(projectPath, initialTask, providers, models);

			// Expose methods to the class instance
			useEffect(() => {
				this.addMessage = addMessage;
				this.updateActivity = updateActivity;
				this.setPhaseFn = setPhase;
				this.setQuitStateFn = setQuitState;

				// Start/refresh the status ticker to keep relative ages updated (less frequent to reduce jitter)
				if (config.enableSyncStatus) {
					if (this.syncTicker) clearInterval(this.syncTicker);
					this.syncTicker = setInterval(() => this.refreshSyncStatus(), 2000);
				}
			}, [
				addMessage,
				updateActivity,
				setPhase,
				setQuitState,
				config.enableSyncStatus,
			]);

			const handleCtrlC = () => {
				if (!this.firstCtrlCPressed) {
					// First Ctrl+C: show confirmation message
					this.firstCtrlCPressed = true;
					if (this.setQuitStateFn) {
						this.setQuitStateFn("confirm");
					}

					// Reset after 3 seconds
					this.confirmExitTimer = setTimeout(() => {
						this.firstCtrlCPressed = false;
						if (this.setQuitStateFn) {
							this.setQuitStateFn("normal");
						}
					}, 3000);
				} else {
					// Second Ctrl+C: actually exit
					if (this.confirmExitTimer) clearTimeout(this.confirmExitTimer);
					onExit();
				}
			};

			return (
				<ErrorBoundary>
					<PairProgrammingApp
						state={state}
						onExit={onExit}
						onCtrlC={handleCtrlC}
					/>
				</ErrorBoundary>
			);
		};

		this.app = render(<AppWrapper />, {
			exitOnCtrlC: false,
		});
	}

	appendMessage(message: Message) {
		if (this.addMessage) {
			this.addMessage(message);
		}
	}

	showNavigatorTurn(content: string) {
		const message: Message = {
			role: "assistant",
			content,
			timestamp: new Date(),
			sessionRole: "navigator",
		};
		this.appendMessage(message);
	}

	showArchitectTurn(content: string) {
		const message: Message = {
			role: "assistant",
			content,
			timestamp: new Date(),
			sessionRole: "architect",
		};
		this.appendMessage(message);
	}

	showDriverTurn(content: string) {
		const message: Message = {
			role: "assistant",
			content,
			timestamp: new Date(),
			sessionRole: "driver",
		};
		this.appendMessage(message);
	}

	showPlan(plan: string) {
		const message: Message = {
			role: "assistant",
			content: `📋 PLAN CREATED:\n${plan}`,
			timestamp: new Date(),
			sessionRole: "navigator",
		};
		this.appendMessage(message);
	}

	showTransitionMessage() {
		const message: Message = {
			role: "system",
			content: "🚀 Starting pair coding session to implement the plan...\n",
			timestamp: new Date(),
			sessionRole: "driver",
			symbol: "",
		};
		this.appendMessage(message);
	}

	// biome-ignore lint/suspicious/noExplicitAny: Tool parameters from Claude Code SDK have varied structure
	showToolUse(role: Role, tool: string, params?: any) {
		let content = tool;
		let symbol: string | undefined;
		let symbolColor: string | undefined;
		const normalizedTool = tool.toLowerCase();

		const formatted = formatSystemLine(role, tool, params);
		const isHuman = !!formatted;
		if (formatted) {
			content = formatted.content;
			symbol = formatted.symbol;
			symbolColor = formatted.symbolColor;
		}

		if (params) {
			const toRel = (p?: string) => {
				if (!p || typeof p !== "string") return p;
				try {
					if (
						path.isAbsolute(p) &&
						this.projectPath &&
						p.startsWith(this.projectPath)
					) {
						const rel = path.relative(this.projectPath, p);
						return rel || ".";
					}
					return p;
				} catch {
					return p;
				}
			};

			// Show detailed parameters (skip for specialized human-friendly MCP lines)
			if (!isHuman) {
				if (normalizedTool === "read" && params.file_path) {
					content += ` - ${toRel(params.file_path)}`;
					if (params.offset) content += ` (from line ${params.offset})`;
				} else if (normalizedTool === "edit" && params.file_path) {
					content += ` - ${toRel(params.file_path)}`;
					if (params.old_string) {
						const preview = params.old_string
							.slice(0, 30)
							.replace(/\n/g, "\\n");
						content += ` (replacing "${preview}...")`;
					}
				} else if (normalizedTool === "write" && params.file_path) {
					content += ` - ${toRel(params.file_path)}`;
				} else if (normalizedTool === "multiedit" && params.file_path) {
					content += ` - ${toRel(params.file_path)} (${params.edits?.length || 0} edits)`;
				} else if (normalizedTool === "bash" && params.command) {
					const cmdFull = String(params.command);
					const cmd = cmdFull.slice(0, 60);
					content += ` - ${cmd}${cmdFull.length > 60 ? "..." : ""}`;
				} else if (normalizedTool === "bashoutput" && params.bash_id) {
					content += ` - shell ${params.bash_id}`;
					if (params.filter) content += ` (filtered: "${params.filter}")`;
				} else if (normalizedTool === "grep" && params.pattern) {
					content += ` - pattern: "${params.pattern}"`;
					if (params.path) content += ` in ${toRel(params.path)}`;
				} else if (normalizedTool === "glob" && params.pattern) {
					content += ` - pattern: "${params.pattern}"`;
					if (params.path) content += ` in ${toRel(params.path)}`;
				} else if (normalizedTool === "todowrite" && params.todos) {
					const count = params.todos?.length || 0;
					const pending =
						// biome-ignore lint/suspicious/noExplicitAny: TodoWrite tool parameter structure
						params.todos?.filter((t: any) => t.status === "pending").length ||
						0;
					const completed =
						// biome-ignore lint/suspicious/noExplicitAny: TodoWrite tool parameter structure
						params.todos?.filter((t: any) => t.status === "completed").length ||
						0;
					content += ` - ${count} items (${completed} done, ${pending} pending)`;
				}
			}
		}

		const message: Message = {
			role: "system",
			content,
			timestamp: new Date(),
			sessionRole: role,
			symbol,
			symbolColor,
		};
		this.appendMessage(message);
	}

	updateStatus(status: string) {
		if (this.updateActivity) {
			this.updateActivity(status);
		}
	}

	showTransfer(_from: Role, _to: Role, _label?: string) {
		// No sync status in UI; keep transfers silent
	}

	private refreshSyncStatus() {
		// Disabled
		return;
	}

	showQueued(from: Role, to: Role, label?: string) {
		const now = new Date();
		const ts = now.toLocaleTimeString("en-US", {
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		const who = to === "driver" ? "Driver" : String(to);
		const content = `⏳ ${ts} Queued for ${who}${label ? ` — ${label}` : ""}`;
		const message: Message = {
			role: "system",
			content,
			timestamp: now,
			sessionRole: from,
		};
		this.appendMessage(message);
	}

	showNavigatorNod(quote: string, reaction: string) {
		const message: Message = {
			role: "assistant",
			content: `👍 "${quote}" - ${reaction}`,
			timestamp: new Date(),
			sessionRole: "navigator",
		};
		this.appendMessage(message);
	}

	showError(error: string) {
		this.updateStatus(`❌ ERROR: ${error}`);
	}

	showCompletionMessage(summary?: string) {
		const separatorMessage: Message = {
			role: "system",
			content: "─".repeat(80),
			timestamp: new Date(),
			sessionRole: "driver",
			symbol: "",
		};
		this.appendMessage(separatorMessage);

		const titleMessage: Message = {
			role: "system",
			content: "✅ Task completed!",
			timestamp: new Date(),
			sessionRole: "driver",
			symbol: "",
		};
		this.appendMessage(titleMessage);

		if (summary && summary.trim().length > 0) {
			const summaryMessage: Message = {
				role: "system",
				content: summary,
				timestamp: new Date(),
				sessionRole: "driver",
				symbol: "",
			};
			this.appendMessage(summaryMessage);
		}
	}

	cleanup() {
		if (this.app?.unmount) {
			this.app.unmount();
		}
		if (this.syncTicker) clearInterval(this.syncTicker);
		if (this.confirmExitTimer) clearTimeout(this.confirmExitTimer);
	}

	public setPhase(phase: SessionPhase) {
		if (this.setPhaseFn) {
			this.setPhaseFn(phase);
		}
		this.currentPhase = phase;
		// Refresh to either start/stop showing sync info based on phase
		if (this.config.enableSyncStatus) {
			this.refreshSyncStatus();
		}
	}

	public getPhase(): SessionPhase | undefined {
		return this.currentPhase;
	}

	public setQuitState(quitState: "normal" | "confirm") {
		if (this.setQuitStateFn) {
			this.setQuitStateFn(quitState);
		}
	}
}
