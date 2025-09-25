import { describe, expect, it, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	ValidationError,
	validateAndSanitizePath,
	validatePrompt,
	validateAndReadPromptFile,
	validateCliArgs,
	schemas,
} from "../../../src/utils/schemas.js";

// Mock fs for controlled testing
vi.mock("node:fs", () => ({
	statSync: vi.fn(),
	readFileSync: vi.fn(),
}));

describe("Zod Validation Schemas", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Default mock for successful directory access
		vi.mocked(fs.statSync).mockReturnValue({
			isDirectory: () => true,
			isFile: () => false,
			size: 1024,
		} as any);
	});

	describe("validateAndSanitizePath", () => {
		it("should validate and resolve valid paths", () => {
			const result = validateAndSanitizePath("./test");
			expect(result).toBe(path.resolve("./test"));
		});

		it("should expand tilde paths", () => {
			process.env.HOME = "/home/user";
			const result = validateAndSanitizePath("~/projects");
			expect(result).toBe(path.resolve("/home/user/projects"));
		});

		it("should reject empty paths", () => {
			expect(() => validateAndSanitizePath("")).toThrow(ValidationError);
			expect(() => validateAndSanitizePath("   ")).toThrow(ValidationError);
		});

		it("should reject null bytes", () => {
			expect(() => validateAndSanitizePath("test\0path")).toThrow(ValidationError);
		});

		it("should reject path traversal", () => {
			expect(() => validateAndSanitizePath("../secrets")).toThrow(ValidationError);
			expect(() => validateAndSanitizePath("test/../secrets")).toThrow(ValidationError);
		});

		it("should reject non-directories", () => {
			vi.mocked(fs.statSync).mockReturnValue({
				isDirectory: () => false,
				isFile: () => true,
			} as any);

			expect(() => validateAndSanitizePath("/path/to/file")).toThrow(ValidationError);
		});

		it("should handle non-existent directories", () => {
			vi.mocked(fs.statSync).mockImplementation(() => {
				const error = new Error("ENOENT") as any;
				error.code = "ENOENT";
				throw error;
			});

			expect(() => validateAndSanitizePath("/nonexistent")).toThrow(ValidationError);
		});

		it("should handle permission errors", () => {
			vi.mocked(fs.statSync).mockImplementation(() => {
				const error = new Error("EACCES") as any;
				error.code = "EACCES";
				throw error;
			});

			expect(() => validateAndSanitizePath("/restricted")).toThrow(ValidationError);
		});
	});

	describe("validatePrompt", () => {
		it("should validate valid prompts", () => {
			const result = validatePrompt("Test prompt");
			expect(result).toBe("Test prompt");
		});

		it("should trim whitespace", () => {
			const result = validatePrompt("  Test prompt  ");
			expect(result).toBe("Test prompt");
		});

		it("should remove null bytes", () => {
			const result = validatePrompt("Test\0prompt");
			expect(result).toBe("Testprompt");
		});

		it("should reject empty prompts", () => {
			expect(() => validatePrompt("")).toThrow(ValidationError);
			expect(() => validatePrompt("   ")).toThrow(ValidationError);
		});

		it("should respect max length", () => {
			const longPrompt = "a".repeat(101);
			expect(() => validatePrompt(longPrompt, 100)).toThrow(ValidationError);
		});

		it("should use default max length", () => {
			const veryLongPrompt = "a".repeat(10001);
			expect(() => validatePrompt(veryLongPrompt)).toThrow(ValidationError);
		});
	});

	describe("validateAndReadPromptFile", () => {
		beforeEach(() => {
			// Mock file stats
			vi.mocked(fs.statSync).mockReturnValue({
				isDirectory: () => false,
				isFile: () => true,
				size: 1024,
			} as any);

			// Mock file content
			vi.mocked(fs.readFileSync).mockReturnValue("Test file content");
		});

		it("should read and validate file content", () => {
			const result = validateAndReadPromptFile("./prompt.txt");
			expect(result).toBe("Test file content");
			expect(fs.readFileSync).toHaveBeenCalledWith(
				path.resolve("./prompt.txt"),
				"utf-8"
			);
		});

		it("should reject files that are too large", () => {
			vi.mocked(fs.statSync).mockReturnValue({
				isDirectory: () => false,
				isFile: () => true,
				size: 200 * 1024, // 200KB > 100KB limit
			} as any);

			expect(() => validateAndReadPromptFile("./large.txt")).toThrow(ValidationError);
		});

		it("should reject directories", () => {
			vi.mocked(fs.statSync).mockReturnValue({
				isDirectory: () => true,
				isFile: () => false,
			} as any);

			expect(() => validateAndReadPromptFile("./directory")).toThrow(ValidationError);
		});

		it("should handle non-existent files", () => {
			vi.mocked(fs.statSync).mockImplementation(() => {
				const error = new Error("ENOENT") as any;
				error.code = "ENOENT";
				throw error;
			});

			expect(() => validateAndReadPromptFile("./missing.txt")).toThrow(ValidationError);
		});

		it("should validate file content as prompt", () => {
			vi.mocked(fs.readFileSync).mockReturnValue("a".repeat(10001)); // Too long

			expect(() => validateAndReadPromptFile("./long.txt")).toThrow(ValidationError);
		});
	});

	describe("validateCliArgs", () => {
		it("should validate valid argument arrays", () => {
			expect(() => validateCliArgs(["--help", "-p", "test"])).not.toThrow();
		});

		it("should reject too many arguments", () => {
			const manyArgs = Array.from({ length: 21 }, (_, i) => `arg${i}`);
			expect(() => validateCliArgs(manyArgs)).toThrow(ValidationError);
		});

		it("should reject arguments with null bytes", () => {
			expect(() => validateCliArgs(["test\0arg"])).toThrow(ValidationError);
		});

		it("should handle empty arrays", () => {
			expect(() => validateCliArgs([])).not.toThrow();
		});
	});

	describe("schemas export", () => {
		it("should export all schemas for external use", () => {
			expect(schemas.path).toBeDefined();
			expect(schemas.prompt).toBeDefined();
			expect(schemas.filePath).toBeDefined();
			expect(schemas.cliArgs).toBeDefined();
		});

		it("should allow direct schema usage", () => {
			const result = schemas.prompt(100).safeParse("Short prompt");
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toBe("Short prompt");
			}
		});

		it("should handle schema validation errors", () => {
			const result = schemas.prompt(10).safeParse("This prompt is too long");
			expect(result.success).toBe(false);
		});
	});
});