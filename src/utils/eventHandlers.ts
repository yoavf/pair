/**
 * Event handler setup for agent display coordination
 */

import type { Driver } from "../conversations/Driver.js";
import type { Navigator } from "../conversations/Navigator.js";
import type { InkDisplayManager } from "../display.js";
import type { Logger } from "./logger.js";

export class EventHandlersManager {
	constructor(
		private planningNavigator: Navigator, // Used during planning phase
		private monitoringNavigator: Navigator, // Used during monitoring phase
		private driver: Driver,
		private display: InkDisplayManager,
		private logger: Logger,
		private addToDriverBuffer: (message: string) => void,
	) {}

	/**
	 * Set up event handlers for display
	 */
	setup(): void {
		// Planning navigator events
		this.planningNavigator.on("message", (message) => {
			this.display.showPlanningTurn(message.content);
			this.logger.logAgentCommunication(
				"navigator-planning",
				"display",
				"message",
				message,
			);
		});

		this.planningNavigator.on("tool_use", ({ tool, input }) => {
			this.display.showToolUse("navigator", tool, input);
			this.logger.logToolUse("navigator-planning", tool, input);
		});

		// Monitoring navigator events
		this.monitoringNavigator.on("message", (message) => {
			if (this.display.getPhase && this.display.getPhase() === "complete") {
				return;
			}
			this.display.showNavigatorTurn(message.content);
			this.logger.logAgentCommunication(
				"navigator-monitoring",
				"display",
				"message",
				message,
			);
		});

		this.monitoringNavigator.on("tool_use", ({ tool, input }) => {
			this.display.showToolUse("navigator", tool, input);
			this.logger.logToolUse("navigator", tool, input);
		});

		// Driver events
		this.driver.on("message", (message) => {
			this.display.showDriverTurn(message.content);
			this.logger.logAgentCommunication(
				"driver",
				"display",
				"message",
				message,
			);
			// Buffer for permission bulk-forwarding
			const t = (message.content || "").trim();
			if (t) this.addToDriverBuffer(t);
		});

		this.driver.on("tool_use", ({ tool, input, trackingId }) => {
			// Preserve trackingId in params for display to use for review coordination
			const inputWithTracking = trackingId ? { ...input, trackingId } : input;
			this.display.showToolUse("driver", tool, inputWithTracking);
			this.logger.logToolUse("driver", tool, input);
			// Summarize tool usage line for buffered transcript
			try {
				const file = input?.file_path || input?.path || "";
				const cmd = input?.command || "";
				const line =
					tool === "Bash" && cmd
						? `⚙️  Tool: Bash - ${String(cmd)}`
						: file
							? `⚙️  Tool: ${tool} - ${file}`
							: `⚙️  Tool: ${tool}`;
				this.addToDriverBuffer(line);
			} catch {}
		});
	}
}
