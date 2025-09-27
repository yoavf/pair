import { describe, expect, it, vi, beforeEach } from "vitest";
import type { InkDisplayManager } from "../../../src/display.js";
import type { Navigator } from "../../../src/conversations/Navigator.js";
import type { Logger } from "../../../src/utils/logger.js";
import { PermissionHandler } from "../../../src/utils/permissionHandler.js";
import { toolTracker } from "../../../src/utils/toolTracking.js";

describe("PermissionHandler", () => {
	beforeEach(() => {
		toolTracker.reset();
	});

	it("forwards toolId from guard options into navigator review", async () => {
		const reviewPermission = vi.fn().mockResolvedValue({
			allowed: true,
			updatedInput: {},
		});
		const navigatorMock = {
			reviewPermission,
		} as unknown as Navigator;
		const displayMock = {
			showTransfer: vi.fn(),
			updateStatus: vi.fn(),
		} as unknown as InkDisplayManager;
		const loggerMock = {
			logEvent: vi.fn(),
			logAgentCommunication: vi.fn(),
		} as unknown as Logger;
		const handler = new PermissionHandler(
			navigatorMock,
			displayMock,
			loggerMock,
		);
		const trackingId = toolTracker.registerTool("Edit", {}, "driver");
		toolTracker.associateCallId(trackingId, "call_abc");
		const canUseTool = handler.createCanUseToolHandler(() => "latest transcript");

		await canUseTool(
			"Edit",
			{ file_path: "demo.txt" },
			{ toolId: "call_abc" },
		);

		expect(reviewPermission).toHaveBeenCalledTimes(1);
		expect(reviewPermission).toHaveBeenCalledWith(
			expect.objectContaining({ toolId: trackingId }),
			expect.any(Object),
		);
	});
});
