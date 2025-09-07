import path from "node:path";
import { render } from "ink";
import type React from "react";
import { useEffect } from "react";
import ErrorBoundary from "./components/ErrorBoundary.js";
import PairProgrammingApp from "./components/PairProgrammingApp.js";
import { useMessages } from "./hooks/useMessages.js";
import type { Message, Role } from "./types.js";
import type { AppConfig } from "./utils/config.js";

interface Props {
	projectPath: string;
	initialTask: string;
	onExit: () => void;
}

const _InkApp: React.FC<Props> = ({ projectPath, initialTask, onExit }) => {
	const { state } = useMessages(projectPath, initialTask);

	return <PairProgrammingApp state={state} onExit={onExit} />;
};

export class InkDisplayManager {
	// biome-ignore lint/suspicious/noExplicitAny: Ink render instance type
	private app: any;
	private addMessage?: (message: Message) => void;
	private updateActivity?: (activity: string) => void;
	// Removed role switching/time remaining helpers
	private setPhaseFn?: (
		phase: "planning" | "execution" | "review" | "complete",
	) => void;
	private setQuitStateFn?: (quitState: "normal" | "confirm") => void;
	private firstCtrlCPressed = false;
	private confirmExitTimer?: NodeJS.Timeout;

	// Track last sync times for status bar
	private lastNavToDriver: Date | null = null;
	private lastDriverToNav: Date | null = null;
	private syncTicker?: NodeJS.Timeout;
	private currentPhase: "planning" | "execution" | "review" | "complete" =
		"planning";
	private lastSyncStatus = "";
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
			const { state, addMessage, updateActivity, setPhase, setQuitState } =
				useMessages(projectPath, initialTask);

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
			content: "🚀 Starting pair coding session to implement the plan...",
			timestamp: new Date(),
			sessionRole: "navigator",
		};
		this.appendMessage(message);
	}

	// biome-ignore lint/suspicious/noExplicitAny: Tool parameters from Claude Code SDK have varied structure
	showToolUse(role: Role, tool: string, params?: any) {
		let content = tool;

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

			// Show detailed parameters
			if (tool === "Read" && params.file_path) {
				content += ` - ${toRel(params.file_path)}`;
				if (params.offset) content += ` (from line ${params.offset})`;
			} else if (tool === "Edit" && params.file_path) {
				content += ` - ${toRel(params.file_path)}`;
				if (params.old_string) {
					const preview = params.old_string.slice(0, 30).replace(/\n/g, "\\n");
					content += ` (replacing "${preview}...")`;
				}
			} else if (tool === "Write" && params.file_path) {
				content += ` - ${toRel(params.file_path)}`;
			} else if (tool === "MultiEdit" && params.file_path) {
				content += ` - ${toRel(params.file_path)} (${params.edits?.length || 0} edits)`;
			} else if (tool === "Bash" && params.command) {
				const cmdFull = String(params.command);
				const cmd = cmdFull.slice(0, 60);
				content += ` - ${cmd}${cmdFull.length > 60 ? "..." : ""}`;
			} else if (tool === "Grep" && params.pattern) {
				content += ` - pattern: "${params.pattern}"`;
				if (params.path) content += ` in ${toRel(params.path)}`;
			} else if (tool === "Glob" && params.pattern) {
				content += ` - pattern: "${params.pattern}"`;
				if (params.path) content += ` in ${toRel(params.path)}`;
			} else if (tool === "TodoWrite" && params.todos) {
				const count = params.todos?.length || 0;
				const pending =
					// biome-ignore lint/suspicious/noExplicitAny: TodoWrite tool parameter structure
					params.todos?.filter((t: any) => t.status === "pending").length || 0;
				const completed =
					// biome-ignore lint/suspicious/noExplicitAny: TodoWrite tool parameter structure
					params.todos?.filter((t: any) => t.status === "completed").length ||
					0;
				content += ` - ${count} items (${completed} done, ${pending} pending)`;
			}
		}

		const message: Message = {
			role: "system",
			content,
			timestamp: new Date(),
			sessionRole: role,
		};
		this.appendMessage(message);
	}

	updateStatus(status: string) {
		if (this.updateActivity) {
			this.updateActivity(status);
		}
	}

	showTransfer(from: Role, to: Role, _label?: string) {
		// Record the last sync time and refresh status line (no transcript output)
		const now = new Date();
		if (from === "navigator" && to === "driver") this.lastNavToDriver = now;
		if (from === "driver" && to === "navigator") this.lastDriverToNav = now;
		if (this.config.enableSyncStatus) {
			this.refreshSyncStatus();
		}
	}

	private refreshSyncStatus() {
		if (!this.updateActivity) return;
		// Only show sync during execution phase
		if (this.currentPhase !== "execution") return;
		const navToDrv = this.lastNavToDriver
			? this.formatRelative(this.lastNavToDriver)
			: "—";
		const drvToNav = this.lastDriverToNav
			? this.formatRelative(this.lastDriverToNav)
			: "—";
		const status = `Sync: Nav→Drv ${navToDrv} • Drv→Nav ${drvToNav}`;

		// Only update if status actually changed to prevent unnecessary re-renders
		if (status !== this.lastSyncStatus) {
			this.lastSyncStatus = status;
			this.updateActivity(status);
		}
	}

	private formatRelative(when: Date): string {
		const sec = Math.max(0, Math.floor((Date.now() - when.getTime()) / 1000));
		if (sec < 1) return "just now";
		if (sec < 60) return `${sec}s`;
		const m = Math.floor(sec / 60);
		const s = sec % 60;
		if (m < 60) return `${m}m${s.toString().padStart(2, "0")}s`;
		const h = Math.floor(m / 60);
		const mm = m % 60;
		return `${h}h${mm.toString().padStart(2, "0")}m`;
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

	cleanup() {
		if (this.app?.unmount) {
			this.app.unmount();
		}
		if (this.syncTicker) clearInterval(this.syncTicker);
		if (this.confirmExitTimer) clearTimeout(this.confirmExitTimer);
	}

	public setPhase(phase: "planning" | "execution" | "review" | "complete") {
		if (this.setPhaseFn) {
			this.setPhaseFn(phase);
		}
		this.currentPhase = phase;
		// Refresh to either start/stop showing sync info based on phase
		if (this.config.enableSyncStatus) {
			this.refreshSyncStatus();
		}
	}

	public setQuitState(quitState: "normal" | "confirm") {
		if (this.setQuitStateFn) {
			this.setQuitStateFn(quitState);
		}
	}
}
