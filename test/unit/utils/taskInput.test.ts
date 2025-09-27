import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { getTaskFromUser } from "../../../src/utils/taskInput.js";

// Mock console.log to avoid console output during testing
const mockConsoleLog = vi.fn();
let mockQuestion = vi.fn();
let mockClose = vi.fn();

vi.mock("node:readline", () => ({
	default: {
		createInterface: vi.fn(() => ({
			question: mockQuestion,
			close: mockClose,
		})),
	},
}));

describe("Task Input Utils", () => {
	let consoleSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		consoleSpy = vi.spyOn(console, "log").mockImplementation(mockConsoleLog);
		mockQuestion.mockReset();
		mockClose.mockReset();
	});

	afterEach(() => {
		vi.clearAllMocks();
		consoleSpy.mockRestore();
	});

	describe("getTaskFromUser", () => {
		it("should display proper instructions with new line break approach", async () => {
			// Mock single line input
			mockQuestion.mockImplementation((prompt, callback) => {
				callback("test input");
			});

			await getTaskFromUser();

			// Verify the instructions are displayed
			expect(mockConsoleLog).toHaveBeenCalledWith("Enter the task for Claude to pair code on.");
			expect(mockConsoleLog).toHaveBeenCalledWith("(Use \\ + Enter for line breaks, or just Enter to submit)");
			expect(mockConsoleLog).toHaveBeenCalledWith("");
		});

		it("should handle single line input", async () => {
			// Mock single line input
			mockQuestion.mockImplementation((prompt, callback) => {
				callback("single line task");
			});

			const result = await getTaskFromUser();
			expect(result).toBe("single line task");
			expect(mockClose).toHaveBeenCalled();
		});

		it("should handle multi-line input with backslash continuation", async () => {
			let callCount = 0;
			mockQuestion.mockImplementation((prompt, callback) => {
				callCount++;
				if (callCount === 1) {
					callback("first line\\");
				} else if (callCount === 2) {
					callback("second line\\");
				} else if (callCount === 3) {
					callback("third line");
				}
			});

			const result = await getTaskFromUser();
			expect(result).toBe("first line\nsecond line\nthird line");
			expect(mockClose).toHaveBeenCalled();
		});

		it("should use proper prompts for continuation lines", async () => {
			let callCount = 0;
			mockQuestion.mockImplementation((prompt, callback) => {
				callCount++;
				if (callCount === 1) {
					expect(prompt).toBe("> ");
					callback("first line\\");
				} else if (callCount === 2) {
					expect(prompt).toBe("  ");
					callback("second line");
				}
			});

			await getTaskFromUser();
		});

		it("should return a function that processes input", () => {
			// Test that the function exists and is callable
			expect(typeof getTaskFromUser).toBe("function");
			expect(getTaskFromUser).toBeInstanceOf(Function);
		});
	});
});