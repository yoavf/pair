/**
 * Test for EventHandlersManager to ensure proper trackingId preservation
 */

import { EventEmitter } from "node:events";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventHandlersManager } from "../../../src/utils/eventHandlers.js";

describe("EventHandlersManager", () => {
	let mockArchitect: any;
	let mockNavigator: any;
	let mockDriver: any;
	let mockDisplay: any;
	let mockLogger: any;
	let mockAddToDriverBuffer: any;
	let eventHandlers: EventHandlersManager;

	beforeEach(() => {
		mockArchitect = new EventEmitter();
		mockNavigator = new EventEmitter();
		mockDriver = new EventEmitter();
		mockDisplay = {
			showArchitectTurn: vi.fn(),
			showNavigatorTurn: vi.fn(),
			showDriverTurn: vi.fn(),
			showToolUse: vi.fn(),
			getPhase: vi.fn().mockReturnValue("implementation"),
		};
		mockLogger = {
			logToolUse: vi.fn(),
		};
		mockAddToDriverBuffer = vi.fn();

		eventHandlers = new EventHandlersManager(
			mockArchitect,
			mockNavigator,
			mockDriver,
			mockDisplay,
			mockLogger,
			mockAddToDriverBuffer,
		);
	});

	describe("Driver Tool Events", () => {
		it("should preserve trackingId when passing driver tool events to display", () => {
			eventHandlers.setup();

			const toolEvent = {
				tool: "Write",
				input: { file_path: "/test/file.ts", content: "test content" },
				trackingId: "TOOL_001",
			};

			// Emit the tool_use event from driver
			mockDriver.emit("tool_use", toolEvent);

			// Verify display.showToolUse was called with trackingId preserved in input
			expect(mockDisplay.showToolUse).toHaveBeenCalledWith(
				"driver",
				"Write",
				{
					file_path: "/test/file.ts",
					content: "test content",
					trackingId: "TOOL_001",
				}
			);
		});

		it("should handle tool events without trackingId gracefully", () => {
			eventHandlers.setup();

			const toolEvent = {
				tool: "Read",
				input: { file_path: "/test/file.ts" },
				// No trackingId for non-reviewable tools
			};

			// Emit the tool_use event from driver
			mockDriver.emit("tool_use", toolEvent);

			// Verify display.showToolUse was called with original input (no trackingId)
			expect(mockDisplay.showToolUse).toHaveBeenCalledWith(
				"driver",
				"Read",
				{ file_path: "/test/file.ts" }
			);
		});

		it("should log tool usage for driver buffer tracking", () => {
			eventHandlers.setup();

			const toolEvent = {
				tool: "Edit",
				input: { file_path: "/test/file.ts", old_string: "old", new_string: "new" },
				trackingId: "TOOL_002",
			};

			// Emit the tool_use event from driver
			mockDriver.emit("tool_use", toolEvent);

			// Verify logging was called with original input (without trackingId)
			expect(mockLogger.logToolUse).toHaveBeenCalledWith(
				"driver",
				"Edit",
				{ file_path: "/test/file.ts", old_string: "old", new_string: "new" }
			);

			// Verify driver buffer was updated with tool summary
			expect(mockAddToDriverBuffer).toHaveBeenCalledWith(
				"⚙️  Tool: Edit - /test/file.ts"
			);
		});
	});

	describe("Navigator and Architect Tool Events", () => {
		it("should handle navigator tool events", () => {
			eventHandlers.setup();

			const toolEvent = {
				tool: "mcp__navigator__navigatorApprove",
				input: { comment: "Approved", requestId: "req-123" },
			};

			mockNavigator.emit("tool_use", toolEvent);

			expect(mockDisplay.showToolUse).toHaveBeenCalledWith(
				"navigator",
				"mcp__navigator__navigatorApprove",
				{ comment: "Approved", requestId: "req-123" }
			);
		});

		it("should handle architect tool events", () => {
			eventHandlers.setup();

			const toolEvent = {
				tool: "Read",
				input: { file_path: "/test/file.ts" },
			};

			mockArchitect.emit("tool_use", toolEvent);

			expect(mockDisplay.showToolUse).toHaveBeenCalledWith(
				"architect",
				"Read",
				{ file_path: "/test/file.ts" }
			);
		});
	});
});