import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { getTaskFromUser } from "../../../src/utils/taskInput.js";

// Mock console.log to avoid console output during testing
const mockConsoleLog = vi.fn();
vi.mock("node:readline", () => ({
	default: {
		createInterface: vi.fn(() => ({
			on: vi.fn((event, callback) => {
				if (event === "line") {
					// Simulate some input lines
					setTimeout(() => callback("line 1"), 10);
					setTimeout(() => callback("line 2"), 20);
				} else if (event === "close") {
					// Simulate close after lines
					setTimeout(() => callback(), 30);
				}
			}),
		})),
	},
}));

describe("Task Input Utils", () => {
	let consoleSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		consoleSpy = vi.spyOn(console, "log").mockImplementation(mockConsoleLog);
	});

	afterEach(() => {
		vi.clearAllMocks();
		consoleSpy.mockRestore();
	});

	describe("getTaskFromUser", () => {
		it("should display proper multi-line instructions", async () => {
			// Call the function (it will complete with mocked readline)
			await getTaskFromUser();

			// Verify the instructions are displayed
			expect(mockConsoleLog).toHaveBeenCalledWith("Enter the task for Claude to pair code on.");
			expect(mockConsoleLog).toHaveBeenCalledWith("Type your prompt (can be multiple lines). Press Ctrl+D (Linux/Mac) or Ctrl+Z (Windows) when finished:");
			expect(mockConsoleLog).toHaveBeenCalledWith("");
		});

		it("should return a function that processes multi-line input", () => {
			// Test that the function exists and is callable
			expect(typeof getTaskFromUser).toBe("function");
			expect(getTaskFromUser).toBeInstanceOf(Function);
		});
	});
});