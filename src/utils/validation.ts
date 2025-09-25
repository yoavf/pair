/**
 * Validation utilities using Zod for input sanitization and type safety
 *
 * This module provides clean, type-safe validation functions backed by Zod schemas.
 * All validation errors are consistently formatted and include field information.
 */

// Re-export everything from schemas for backwards compatibility
export {
	schemas,
	ValidationError,
	validateAndReadPromptFile,
	validateAndSanitizePath,
	validateCliArgs,
	validatePrompt,
} from "./schemas.js";
