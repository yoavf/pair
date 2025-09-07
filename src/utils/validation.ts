import * as fs from "node:fs";
import * as path from "node:path";
import type { NodeError } from "../types.js";

/**
 * Validation utilities for input sanitization and security
 */

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
 * Validates and sanitizes file paths to prevent path traversal attacks
 */
export function validateAndSanitizePath(inputPath: string): string {
	if (!inputPath || typeof inputPath !== "string") {
		throw new ValidationError("Path must be a non-empty string", "path");
	}

	// Remove null bytes and other dangerous characters
	const sanitized = inputPath.replace(/\0/g, "").trim();

	if (sanitized.length === 0) {
		throw new ValidationError(
			"Path cannot be empty after sanitization",
			"path",
		);
	}

	// Check for obvious path traversal attempts
	if (sanitized.includes("..")) {
		throw new ValidationError(
			"Path traversal sequences (..) are not allowed",
			"path",
		);
	}

	// Handle tilde expansion safely
	let expandedPath = sanitized;
	if (expandedPath.startsWith("~")) {
		const homeDir = process.env.HOME;
		if (!homeDir) {
			throw new ValidationError(
				"Cannot expand ~ - HOME environment variable not set",
				"path",
			);
		}
		expandedPath = expandedPath.replace("~", homeDir);
	}

	// Convert to absolute path
	const absolutePath = path.resolve(expandedPath);

	// Verify the path exists and is accessible
	try {
		const stats = fs.statSync(absolutePath);
		if (!stats.isDirectory()) {
			throw new ValidationError("Path must be a directory", "path");
		}
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

	return absolutePath;
}

/**
 * Validates prompt text input
 */
export function validatePrompt(
	prompt: string,
	maxLength: number = 10000,
): string {
	if (!prompt || typeof prompt !== "string") {
		throw new ValidationError("Prompt must be a non-empty string", "prompt");
	}

	const trimmed = prompt.trim();
	if (trimmed.length === 0) {
		throw new ValidationError("Prompt cannot be empty", "prompt");
	}

	if (trimmed.length > maxLength) {
		throw new ValidationError(
			`Prompt cannot exceed ${maxLength} characters`,
			"prompt",
		);
	}

	// Remove any null bytes
	const sanitized = trimmed.replace(/\0/g, "");

	return sanitized;
}

/**
 * Validates and reads a prompt file
 */
export function validateAndReadPromptFile(filePath: string): string {
	if (!filePath || typeof filePath !== "string") {
		throw new ValidationError("File path must be a non-empty string", "file");
	}

	// Sanitize the file path
	const sanitized = filePath.replace(/\0/g, "").trim();

	if (sanitized.length === 0) {
		throw new ValidationError("File path cannot be empty", "file");
	}

	// Check for path traversal
	if (sanitized.includes("..")) {
		throw new ValidationError(
			"Path traversal sequences (..) are not allowed in file paths",
			"file",
		);
	}

	// Handle tilde expansion
	let expandedPath = sanitized;
	if (expandedPath.startsWith("~")) {
		const homeDir = process.env.HOME;
		if (!homeDir) {
			throw new ValidationError(
				"Cannot expand ~ - HOME environment variable not set",
				"file",
			);
		}
		expandedPath = expandedPath.replace("~", homeDir);
	}

	// Convert to absolute path
	const absolutePath = path.resolve(expandedPath);

	// Verify file exists and is readable
	try {
		const stats = fs.statSync(absolutePath);
		if (!stats.isFile()) {
			throw new ValidationError("Path must be a file", "file");
		}

		// Check file size (limit to 100KB)
		if (stats.size > 100 * 1024) {
			throw new ValidationError("Prompt file cannot exceed 100KB", "file");
		}

		// Read and validate content
		const content = fs.readFileSync(absolutePath, "utf-8");
		return validatePrompt(content);
	} catch (error) {
		if (error instanceof ValidationError) {
			throw error;
		}
		const nodeError = error as NodeError;
		if (nodeError.code === "ENOENT") {
			throw new ValidationError(`File does not exist: ${absolutePath}`, "file");
		} else if (nodeError.code === "EACCES") {
			throw new ValidationError(
				`Permission denied reading file: ${absolutePath}`,
				"file",
			);
		}
		throw new ValidationError(`Cannot read file: ${absolutePath}`, "file");
	}
}

/**
 * Validates CLI arguments
 */
export function validateCliArgs(args: string[]): void {
	if (args.length > 20) {
		throw new ValidationError("Too many command line arguments", "args");
	}

	for (const arg of args) {
		if (typeof arg !== "string") {
			throw new ValidationError("All arguments must be strings", "args");
		}
		if (arg.includes("\0")) {
			throw new ValidationError("Arguments cannot contain null bytes", "args");
		}
	}
}
