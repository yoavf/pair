import { describe, it, expect } from "vitest";
import { formatSystemLine } from "../../src/utils/systemLine.js";

describe("formatSystemLine", () => {
  it("formats navigator approve with green checkmark", () => {
    const out = formatSystemLine("navigator", "mcp__navigator__navigatorApprove", { comment: "Looks good" });
    expect(out).not.toBeNull();
    expect(out!.content).toBe("Approved: Looks good");
    expect(out!.symbol).toBe("✓");
    expect(out!.symbolColor).toBe("#00ff00");
  });

  it("formats navigator deny with red x", () => {
    const out = formatSystemLine("navigator", "mcp__navigator__navigatorDeny", { comment: "Missing tests" });
    expect(out).not.toBeNull();
    expect(out!.content).toBe("Denied: Missing tests");
    expect(out!.symbol).toBe("x");
    expect(out!.symbolColor).toBe("#ff0000");
  });

  it("formats navigator code review with cyan bullet", () => {
    const out = formatSystemLine("navigator", "mcp__navigator__navigatorCodeReview", { comment: "Please address nits", pass: false });
    expect(out).not.toBeNull();
    expect(out!.content).toBe("Code Review: Please address nits");
    expect(out!.symbol).toBe("•");
    expect(out!.symbolColor).toBe("cyan");
  });

  it("formats navigator code review with pass", () => {
    const out = formatSystemLine("navigator", "mcp__navigator__navigatorCodeReview", { comment: "All tasks completed", pass: true });
    expect(out).not.toBeNull();
    expect(out!.content).toBe("Code Review (pass)");
    expect(out!.symbol).toBe("•");
    expect(out!.symbolColor).toBe("cyan");
  });

  it("formats driver request review without leading dot (suppressed symbol)", () => {
    const out = formatSystemLine("driver", "mcp__driver__driverRequestReview", { context: "Done" });
    expect(out).not.toBeNull();
    expect(out!.content).toBe("🔍 Review requested: Done");
    expect(out!.symbol).toBe("");
  });
});
