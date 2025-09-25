/**
 * Event handler setup for agent display coordination
 */

import type { Architect } from "../conversations/Architect.js";
import type { Driver } from "../conversations/Driver.js";
import type { Navigator } from "../conversations/Navigator.js";
import type { InkDisplayManager } from "../display.js";
import type { Logger } from "./logger.js";

export class EventHandlersManager {
	constructor(
		private architect: Architect,
		private navigator: Navigator,
		private driver: Driver,
		private display: InkDisplayManager,
		private logger: Logger,
		private addToDriverBuffer: (message: string) => void,
	) {}

	/**
	 * Set up event handlers for display
	 */
	setup(): void {
		// Architect events
		this.architect.on("message", (message) => {
			this.display.showArchitectTurn(message.content);
		});

		this.architect.on("tool_use", ({ tool, input }) => {
			this.display.showToolUse("architect", tool, input);
			this.logger.logEvent("ARCHITECT_TOOL_USE", {
				tool,
				inputKeys: Object.keys(input || {}),
			});
		});

		// Navigator events
		this.navigator.on("message", (message) => {
			if (this.display.getPhase && this.display.getPhase() === "complete") {
				return;
			}
			this.display.showNavigatorTurn(message.content);
		});

		this.navigator.on("tool_use", ({ tool, input }) => {
			this.display.showToolUse("navigator", tool, input);
			this.logger.logEvent("NAVIGATOR_TOOL_USE", {
				tool,
				inputKeys: Object.keys(input || {}),
			});
		});

		// Driver events
		this.driver.on("message", (message) => {
			this.display.showDriverTurn(message.content);
			// Buffer for permission bulk-forwarding
			const t = (message.content || "").trim();
			if (t) this.addToDriverBuffer(t);
		});

		this.driver.on("tool_use", ({ tool, input }) => {
			this.display.showToolUse("driver", tool, input);
			this.logger.logEvent("DRIVER_TOOL_USE", {
				tool,
				inputKeys: Object.keys(input || {}),
			});
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
