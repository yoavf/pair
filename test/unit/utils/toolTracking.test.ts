import { describe, expect, it, beforeEach, vi } from "vitest";
import { ToolTracker } from "../../../src/utils/toolTracking.js";

describe("ToolTracker", () => {
  let tracker: ToolTracker;

  beforeEach(() => {
    tracker = new ToolTracker();
    tracker.reset();
  });

  describe("generateToolId", () => {
    it("should generate sequential IDs", () => {
      expect(tracker.generateToolId()).toBe("TOOL_001");
      expect(tracker.generateToolId()).toBe("TOOL_002");
      expect(tracker.generateToolId()).toBe("TOOL_003");
    });

    it("should pad IDs correctly", () => {
      // Generate 10 IDs
      for (let i = 0; i < 10; i++) {
        tracker.generateToolId();
      }
      expect(tracker.generateToolId()).toBe("TOOL_011");
    });
  });

  describe("registerTool", () => {
    it("should register a tool and return its ID", () => {
      const id = tracker.registerTool("Write", { file_path: "test.txt" }, "driver");
      expect(id).toBe("TOOL_001");

      const tool = tracker.getTool(id);
      expect(tool).toBeDefined();
      expect(tool?.toolName).toBe("Write");
      expect(tool?.input).toEqual({ file_path: "test.txt" });
      expect(tool?.role).toBe("driver");
      expect(tool?.status).toBe("pending");
    });

    it("should track reviewable tools for pending reviews", () => {
      const id1 = tracker.registerTool("Write", {}, "driver");
      const id2 = tracker.registerTool("Read", {}, "driver");
      const id3 = tracker.registerTool("Edit", {}, "driver");

      const pending = tracker.getPendingTools();
      expect(pending).toHaveLength(2); // Write and Edit
      expect(pending.map(t => t.id)).toContain(id1);
      expect(pending.map(t => t.id)).toContain(id3);
      expect(pending.map(t => t.id)).not.toContain(id2); // Read is not reviewable
    });

    it("should not track non-driver tools for review", () => {
      tracker.registerTool("Write", {}, "navigator");
      tracker.registerTool("Edit", {}, "architect");

      const pending = tracker.getPendingTools();
      expect(pending).toHaveLength(0);
    });
  });

  describe("isReviewableTool", () => {
    it("should identify reviewable tools", () => {
      expect(tracker.isReviewableTool("Write")).toBe(true);
      expect(tracker.isReviewableTool("Edit")).toBe(true);
      expect(tracker.isReviewableTool("MultiEdit")).toBe(true);
      expect(tracker.isReviewableTool("NotebookEdit")).toBe(true);
    });

    it("should identify non-reviewable tools", () => {
      expect(tracker.isReviewableTool("Read")).toBe(false);
      expect(tracker.isReviewableTool("Bash")).toBe(false);
      expect(tracker.isReviewableTool("Grep")).toBe(false);
      expect(tracker.isReviewableTool("WebFetch")).toBe(false);
    });
  });

  describe("recordReview", () => {
    it("should record approval", () => {
      const id = tracker.registerTool("Write", {}, "driver");
      tracker.recordReview(id, true, "Looks good!");

      const tool = tracker.getTool(id);
      expect(tool?.status).toBe("approved");
      expect(tool?.reviewComment).toBe("Looks good!");

      const pending = tracker.getPendingTools();
      expect(pending.map(t => t.id)).not.toContain(id);
    });

    it("should record denial", () => {
      const id = tracker.registerTool("Edit", {}, "driver");
      tracker.recordReview(id, false, "Please fix the indentation");

      const tool = tracker.getTool(id);
      expect(tool?.status).toBe("denied");
      expect(tool?.reviewComment).toBe("Please fix the indentation");
    });

    it("should trigger waiting callbacks", async () => {
      const id = tracker.registerTool("Write", {}, "driver");

      const resultPromise = tracker.waitForReview(id);

      // Record review after a short delay
      setTimeout(() => {
        tracker.recordReview(id, true, "Approved");
      }, 10);

      const result = await resultPromise;
      expect(result).toEqual({
        toolId: id,
        approved: true,
        comment: "Approved"
      });
    });
  });

  describe("waitForReview", () => {
    it("should return immediately if already reviewed", async () => {
      const id = tracker.registerTool("Write", {}, "driver");
      tracker.recordReview(id, false, "Denied");

      const result = await tracker.waitForReview(id);
      expect(result).toEqual({
        toolId: id,
        approved: false,
        comment: "Denied"
      });
    });

    it("should timeout if no review arrives", async () => {
      const id = tracker.registerTool("Write", {}, "driver");

      // Mock timeout to 100ms for faster test
      const originalTimeout = (tracker as any).REVIEW_TIMEOUT_MS;
      (tracker as any).REVIEW_TIMEOUT_MS = 100;

      const startTime = Date.now();
      const result = await tracker.waitForReview(id);
      const elapsed = Date.now() - startTime;

      expect(result).toBeNull();
      expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some margin
      expect(elapsed).toBeLessThan(150);

      // Restore original timeout
      (tracker as any).REVIEW_TIMEOUT_MS = originalTimeout;
    });

    it("should handle multiple waiting tools", async () => {
      const id1 = tracker.registerTool("Write", {}, "driver");
      const id2 = tracker.registerTool("Edit", {}, "driver");

      const result1Promise = tracker.waitForReview(id1);
      const result2Promise = tracker.waitForReview(id2);

      // Review in different order
      setTimeout(() => {
        tracker.recordReview(id2, false, "Review 2");
      }, 10);
      setTimeout(() => {
        tracker.recordReview(id1, true, "Review 1");
      }, 20);

      const [result1, result2] = await Promise.all([result1Promise, result2Promise]);

      expect(result1).toEqual({
        toolId: id1,
        approved: true,
        comment: "Review 1"
      });
      expect(result2).toEqual({
        toolId: id2,
        approved: false,
        comment: "Review 2"
      });
    });
  });

  describe("markDisplayed", () => {
    it("should mark tool as displayed", () => {
      const id = tracker.registerTool("Write", {}, "driver");
      tracker.markDisplayed(id);

      const tool = tracker.getTool(id);
      expect(tool?.status).toBe("displayed");
    });
  });

  describe("clearOldTools", () => {
    it("should clear tools older than max age", () => {
      const id1 = tracker.registerTool("Write", {}, "driver");

      // Manually set timestamp to be old
      const tool1 = tracker.getTool(id1)!;
      tool1.timestamp = new Date(Date.now() - 400000); // 6+ minutes ago

      const id2 = tracker.registerTool("Edit", {}, "driver");

      // Clear with 5 minute max age
      tracker.clearOldTools(300000);

      expect(tracker.getTool(id1)).toBeUndefined();
      expect(tracker.getTool(id2)).toBeDefined();
    });

    it("should clean up all associated data", () => {
      const id = tracker.registerTool("Write", {}, "driver");

      // Set up some associated data
      (tracker as any).reviewCallbacks.set(id, () => {});

      // Make it old
      const tool = tracker.getTool(id)!;
      tool.timestamp = new Date(Date.now() - 400000);

      tracker.clearOldTools(300000);

      expect(tracker.getTool(id)).toBeUndefined();
      expect(tracker.getPendingTools()).toHaveLength(0);
      expect((tracker as any).reviewCallbacks.has(id)).toBe(false);
    });
  });

  describe("reset", () => {
    it("should clear all data and reset counter", () => {
      tracker.registerTool("Write", {}, "driver");
      tracker.registerTool("Edit", {}, "driver");

      expect(tracker.generateToolId()).toBe("TOOL_003");
      expect(tracker.getPendingTools()).toHaveLength(2);

      tracker.reset();

      expect(tracker.generateToolId()).toBe("TOOL_001");
      expect(tracker.getPendingTools()).toHaveLength(0);
    });
  });
});