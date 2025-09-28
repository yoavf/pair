import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { getTaskFromUser } from "../../../src/utils/taskInput.js";

// Mock console.log to avoid console output during testing
const mockConsoleLog = vi.fn();
const mockStdoutWrite = vi.fn();
const mockStdinOn = vi.fn();
const mockStdinRemoveAllListeners = vi.fn();
const mockStdinSetRawMode = vi.fn();
const mockStdinResume = vi.fn();
const mockStdinPause = vi.fn();
const mockStdinSetEncoding = vi.fn();
const mockProcessExit = vi.fn();

// Store original values
const originalStdin = process.stdin;
const originalStdout = process.stdout;

describe("Task Input Utils", () => {
	let consoleSpy: ReturnType<typeof vi.spyOn>;
	let processExitSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		consoleSpy = vi.spyOn(console, "log").mockImplementation(mockConsoleLog);
		processExitSpy = vi.spyOn(process, 'exit').mockImplementation(mockProcessExit);

		// Mock process.stdin
		Object.defineProperty(process, 'stdin', {
			value: {
				isTTY: true,
				setRawMode: mockStdinSetRawMode,
				resume: mockStdinResume,
				pause: mockStdinPause,
				setEncoding: mockStdinSetEncoding,
				on: mockStdinOn,
				removeAllListeners: mockStdinRemoveAllListeners,
			},
			configurable: true,
		});

		// Mock process.stdout
		Object.defineProperty(process, 'stdout', {
			value: {
				write: mockStdoutWrite,
			},
			configurable: true,
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
		consoleSpy.mockRestore();
		processExitSpy.mockRestore();

		// Restore original values
		Object.defineProperty(process, 'stdin', {
			value: originalStdin,
			configurable: true,
		});
		Object.defineProperty(process, 'stdout', {
			value: originalStdout,
			configurable: true,
		});
	});

	describe("getTaskFromUser", () => {
		it("should display proper instructions with new line break approach", async () => {
			// Mock stdin to immediately call the callback with Enter
			mockStdinOn.mockImplementation((event, callback) => {
				if (event === 'data') {
					setTimeout(() => callback(Buffer.from('\r')), 0);
				}
			});

			await getTaskFromUser();

			// Verify the instructions are displayed
			expect(mockConsoleLog).toHaveBeenCalledWith("Enter your prompt to launch a pair-coding session");
			expect(mockConsoleLog).toHaveBeenCalledWith("");
		});

		it("should handle single line input", async () => {
			let dataCallback: (key: Buffer) => void;

			mockStdinOn.mockImplementation((event, callback) => {
				if (event === 'data') {
					dataCallback = callback;
					// Simulate typing "test" and pressing Enter
					setTimeout(() => {
						callback(Buffer.from('t'));
						callback(Buffer.from('e'));
						callback(Buffer.from('s'));
						callback(Buffer.from('t'));
						callback(Buffer.from('\r'));
					}, 0);
				}
			});

			const result = await getTaskFromUser();
			expect(result).toBe("test");
		});

		it("should handle multi-line input with backslash continuation", async () => {
			mockStdinOn.mockImplementation((event, callback) => {
				if (event === 'data') {
					// Simulate typing "first line\" + Enter + "second line" + Enter
					setTimeout(() => {
						// Type "first line\"
						"first line\\".split('').forEach(char => callback(Buffer.from(char)));
						callback(Buffer.from('\r')); // Enter after backslash

						// Type "second line"
						"second line".split('').forEach(char => callback(Buffer.from(char)));
						callback(Buffer.from('\r')); // Final Enter
					}, 0);
				}
			});

			const result = await getTaskFromUser();
			expect(result).toBe("first line\nsecond line");
		});

		it("should handle Shift+Enter for line breaks", async () => {
			mockStdinOn.mockImplementation((event, callback) => {
				if (event === 'data') {
					setTimeout(() => {
						// Type "first line"
						"first line".split('').forEach(char => callback(Buffer.from(char)));
						callback(Buffer.from('\r\n')); // Shift+Enter

						// Type "second line"
						"second line".split('').forEach(char => callback(Buffer.from(char)));
						callback(Buffer.from('\r')); // Final Enter
					}, 0);
				}
			});

			const result = await getTaskFromUser();
			expect(result).toBe("first line\nsecond line");
		});

		it("should handle backspace correctly", async () => {
			mockStdinOn.mockImplementation((event, callback) => {
				if (event === 'data') {
					setTimeout(() => {
						// Type "test", backspace, type "st"
						"test".split('').forEach(char => callback(Buffer.from(char)));
						callback(Buffer.from('\u007f')); // Backspace
						"st".split('').forEach(char => callback(Buffer.from(char)));
						callback(Buffer.from('\r')); // Enter
					}, 0);
				}
			});

			const result = await getTaskFromUser();
			expect(result).toBe("tesst");
		});

		it("should handle Ctrl+C", async () => {
			const promise = new Promise<void>((resolve) => {
				mockStdinOn.mockImplementation((event, callback) => {
					if (event === 'data') {
						setTimeout(() => {
							callback(Buffer.from('\u0003')); // Ctrl+C
							resolve();
						}, 0);
					}
				});
			});

			getTaskFromUser(); // Don't await this as it will call process.exit
			await promise;

			expect(mockProcessExit).toHaveBeenCalledWith(0);
		});

		it("should return a function that processes input", () => {
			// Test that the function exists and is callable
			expect(typeof getTaskFromUser).toBe("function");
			expect(getTaskFromUser).toBeInstanceOf(Function);
		});
	});
});