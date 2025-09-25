/**
 * Zod validation schemas for input sanitization and type safety
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { NodeError } from "../types.js";

export class ValidationError extends Error {
	constructor(
		message: string,
		public readonly field?: string,
	) {
		super(message);
		this.name = "ValidationError";
	}
}

/**
 * Schema for validating file paths
 */
const pathSchema = z
	.string()
	.min(1, "Path cannot be empty")
	.refine((val) => val.trim().length > 0, "Path cannot be empty after trimming")
	.refine((val) => !val.includes("\0"), "Path cannot contain null bytes")
	.refine(
		(val) => !val.includes(".."),
		"Path traversal sequences (..) are not allowed",
	)
	.transform((val) => {
		// Handle tilde expansion
		let expanded = val.trim();
		if (expanded.startsWith("~")) {
			const homeDir = process.env.HOME;
			if (!homeDir) {
				throw new ValidationError(
					"Cannot expand ~ - HOME environment variable not set",
					"path",
				);
			}
			expanded = expanded.replace("~", homeDir);
		}
		return path.resolve(expanded);
	})
	.refine((absolutePath) => {
		try {
			const stats = fs.statSync(absolutePath);
			return stats.isDirectory();
		} catch (error) {
			const nodeError = error as NodeError;
			if (nodeError.code === "ENOENT") {
				throw new ValidationError(
					`Directory does not exist: ${absolutePath}`,
					"path",
				);
			} else if (nodeError.code === "EACCES") {
				throw new ValidationError(
					`Permission denied accessing: ${absolutePath}`,
					"path",
				);
			}
			throw new ValidationError(
				`Cannot access directory: ${absolutePath}`,
				"path",
			);
		}
	}, "Path must be an accessible directory");

/**
 * Schema for validating prompt text
 */
const promptSchema = (maxLength = 10000) =>
	z
		.string()
		.min(1, "Prompt cannot be empty")
		.max(maxLength, `Prompt cannot exceed ${maxLength} characters`)
		.refine(
			(val) => val.trim().length > 0,
			"Prompt cannot be empty after trimming",
		)
		.transform((val) => val.trim().replace(/\0/g, ""));

/**
 * Schema for validating file paths that should point to files
 */
const filePathSchema = z
	.string()
	.min(1, "File path cannot be empty")
	.refine((val) => !val.includes("\0"), "File path cannot contain null bytes")
	.refine(
		(val) => !val.includes(".."),
		"Path traversal sequences (..) are not allowed in file paths",
	)
	.transform((val) => {
		// Handle tilde expansion
		let expanded = val.trim();
		if (expanded.startsWith("~")) {
			const homeDir = process.env.HOME;
			if (!homeDir) {
				throw new ValidationError(
					"Cannot expand ~ - HOME environment variable not set",
					"file",
				);
			}
			expanded = expanded.replace("~", homeDir);
		}
		return path.resolve(expanded);
	})
	.refine((absolutePath) => {
		try {
			const stats = fs.statSync(absolutePath);
			if (!stats.isFile()) {
				throw new ValidationError("Path must be a file", "file");
			}
			// Check file size (limit to 100KB)
			if (stats.size > 100 * 1024) {
				throw new ValidationError("Prompt file cannot exceed 100KB", "file");
			}
			return true;
		} catch (error) {
			if (error instanceof ValidationError) {
				throw error;
			}
			const nodeError = error as NodeError;
			if (nodeError.code === "ENOENT") {
				throw new ValidationError(
					`File does not exist: ${absolutePath}`,
					"file",
				);
			} else if (nodeError.code === "EACCES") {
				throw new ValidationError(
					`Permission denied reading file: ${absolutePath}`,
					"file",
				);
			}
			throw new ValidationError(`Cannot read file: ${absolutePath}`, "file");
		}
	}, "File must be accessible and readable");

/**
 * Schema for validating CLI arguments
 */
const cliArgsSchema = z
	.array(
		z
			.string()
			.refine(
				(val) => !val.includes("\0"),
				"Arguments cannot contain null bytes",
			),
	)
	.max(20, "Too many command line arguments");

/**
 * Validation functions using Zod schemas
 */
export function validateAndSanitizePath(inputPath: string): string {
	try {
		return pathSchema.parse(inputPath);
	} catch (error) {
		if (error instanceof z.ZodError) {
			const issue = error.issues[0];
			throw new ValidationError(issue.message, "path");
		}
		throw error;
	}
}

export function validatePrompt(prompt: string, maxLength = 10000): string {
	try {
		return promptSchema(maxLength).parse(prompt);
	} catch (error) {
		if (error instanceof z.ZodError) {
			const issue = error.issues[0];
			throw new ValidationError(issue.message, "prompt");
		}
		throw error;
	}
}

export function validateAndReadPromptFile(filePath: string): string {
	try {
		const validatedPath = filePathSchema.parse(filePath);
		const content = fs.readFileSync(validatedPath, "utf-8");
		return validatePrompt(content);
	} catch (error) {
		if (error instanceof z.ZodError) {
			const issue = error.issues[0];
			throw new ValidationError(issue.message, "file");
		}
		throw error;
	}
}

export function validateCliArgs(args: string[]): void {
	try {
		cliArgsSchema.parse(args);
	} catch (error) {
		if (error instanceof z.ZodError) {
			const issue = error.issues[0];
			throw new ValidationError(issue.message, "args");
		}
		throw error;
	}
}

// Export schemas for external use
export const schemas = {
	path: pathSchema,
	prompt: promptSchema,
	filePath: filePathSchema,
	cliArgs: cliArgsSchema,
};
