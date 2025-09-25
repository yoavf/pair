import { describe, expect, it, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { InkDisplayManager } from "../../src/display.js";
import { toolTracker } from "../../src/utils/toolTracking.js";
import type { Message, Role } from "../../src/types.js";

// Mock dependencies
vi.mock("ink", () => ({
  render: vi.fn(() => ({
    unmount: vi.fn(),
    clear: vi.fn(),
    waitUntilExit: vi.fn(() => Promise.resolve()),
  })),
}));

describe("Review Synchronization Integration", () => {
  let display: InkDisplayManager;
  let messages: Message[];
  let mockAddMessage: (msg: Message) => void;

  beforeEach(() => {
    // Reset tool tracker
    toolTracker.reset();

    // Mock Ink app and message collection
    messages = [];
    mockAddMessage = vi.fn((msg: Message) => {
      messages.push(msg);
    });

    // Create display instance
    display = new InkDisplayManager();

    // Mock the appendMessage method to capture messages
    (display as any).appendMessage = mockAddMessage;
  });

  it("should display tool and review together when review is provided", async () => {
    // Register a tool with tracking
    const trackingId = toolTracker.registerTool("Write", { file_path: "test.txt" }, "driver");

    // Show tool use with tracking ID
    display.showToolUse("driver", "Write", {
      file_path: "test.txt",
      trackingId
    });

    // Initially, no messages should be displayed (waiting for review)
    expect(messages).toHaveLength(0);

    // Simulate review approval
    toolTracker.recordReview(trackingId, true, "Looks good!");

    // Wait for async display
    await new Promise(resolve => setTimeout(resolve, 50));

    // Should have both tool and review messages
    expect(messages).toHaveLength(2);

    // First message should be the tool
    expect(messages[0].content).toContain("Write");
    expect(messages[0].content).toContain("test.txt");
    expect(messages[0].sessionRole).toBe("driver");

    // Second message should be the review
    expect(messages[1].content).toContain("Approved");
    expect(messages[1].content).toContain("Looks good!");
    expect(messages[1].sessionRole).toBe("navigator");
  });

  it("should display tool and denial together", async () => {
    const trackingId = toolTracker.registerTool("Edit", { file_path: "app.js" }, "driver");

    display.showToolUse("driver", "Edit", {
      file_path: "app.js",
      old_string: "foo",
      new_string: "bar",
      trackingId
    });

    // Record denial
    toolTracker.recordReview(trackingId, false, "Incorrect change");

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(messages).toHaveLength(2);
    expect(messages[1].content).toContain("Denied");
    expect(messages[1].content).toContain("Incorrect change");
    expect(messages[1].symbol).toBe("❌");
  });

  it("should display tool without review on timeout", async () => {
    // Mock shorter timeout for testing
    (toolTracker as any).REVIEW_TIMEOUT_MS = 100;

    const trackingId = toolTracker.registerTool("MultiEdit", { file_path: "test.py" }, "driver");

    display.showToolUse("driver", "MultiEdit", {
      file_path: "test.py",
      edits: [],
      trackingId
    });

    // Wait for timeout
    await new Promise(resolve => setTimeout(resolve, 150));

    // Should have only the tool message (no review)
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("MultiEdit");

    // Restore timeout
    (toolTracker as any).REVIEW_TIMEOUT_MS = 2000;
  });

  it("should display non-reviewable tools immediately", () => {
    // Non-reviewable tool should display immediately
    display.showToolUse("driver", "Read", { file_path: "readme.md" });

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("Read");
    expect(messages[0].content).toContain("readme.md");
  });

  it("should handle multiple tools with reviews in correct order", async () => {
    const id1 = toolTracker.registerTool("Write", { file_path: "file1.txt" }, "driver");
    const id2 = toolTracker.registerTool("Edit", { file_path: "file2.txt" }, "driver");

    // Show both tools
    display.showToolUse("driver", "Write", { file_path: "file1.txt", trackingId: id1 });
    display.showToolUse("driver", "Edit", { file_path: "file2.txt", trackingId: id2 });

    // No messages yet (waiting for reviews)
    expect(messages).toHaveLength(0);

    // Review second tool first
    toolTracker.recordReview(id2, true, "Edit approved");
    await new Promise(resolve => setTimeout(resolve, 10));

    // Should have tool2 and its review
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain("file2.txt");
    expect(messages[1].content).toContain("Edit approved");

    // Review first tool
    toolTracker.recordReview(id1, false, "Write denied");
    await new Promise(resolve => setTimeout(resolve, 10));

    // Should now have all 4 messages
    expect(messages).toHaveLength(4);
    expect(messages[2].content).toContain("file1.txt");
    expect(messages[3].content).toContain("Write denied");
  });

  it("should handle navigator's own tools without tracking", () => {
    // Navigator tools don't get tracked
    display.showToolUse("navigator", "Read", { file_path: "check.txt" });

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("Read");
    expect(messages[0].sessionRole).toBe("navigator");
  });

  it("should clean up pending displays on timeout", async () => {
    (toolTracker as any).REVIEW_TIMEOUT_MS = 100;

    const trackingId = toolTracker.registerTool("Write", { file_path: "pending.txt" }, "driver");

    display.showToolUse("driver", "Write", {
      file_path: "pending.txt",
      trackingId
    });

    // Check pending displays exists
    expect((display as any).pendingToolDisplays.size).toBe(1);

    // Wait for timeout
    await new Promise(resolve => setTimeout(resolve, 150));

    // Pending displays should be cleared
    expect((display as any).pendingToolDisplays.size).toBe(0);

    (toolTracker as any).REVIEW_TIMEOUT_MS = 2000;
  });
});