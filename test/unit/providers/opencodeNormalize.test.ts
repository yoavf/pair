import { describe, it, expect } from "vitest";

import {
	mapPartToolName,
	normalizeToolInput,
	resolvePermissionToolName,
	resolveToolName,
} from "../../../src/providers/embedded/opencode/normalization.js";

describe("OpenCode tool normalization", () => {
	it("maps pair-* navigator tools to canonical names", () => {
		expect(mapPartToolName("pair-navigator_navigatorComplete")).toBe(
			"mcp__navigator__navigatorComplete",
		);
		expect(mapPartToolName("pair-driver_driverRequestReview")).toBe(
			"mcp__driver__driverRequestReview",
		);
	});

	it("normalizes read input paths", () => {
		const input = { path: "/tmp/data.txt" };
		const normalized = normalizeToolInput("Read", input);
		expect(normalized.file_path).toBe("/tmp/data.txt");
		// original keys remain
		expect(normalized.path).toBe("/tmp/data.txt");
	});

	it("normalizes edit inputs with camel case keys", () => {
		const input = {
			filePath: "src/index.ts",
			oldString: "foo",
			newString: "bar",
		};
		const normalized = normalizeToolInput("Edit", input);
		expect(normalized.file_path).toBe("src/index.ts");
		expect(normalized.old_string).toBe("foo");
		expect(normalized.new_string).toBe("bar");
	});

	it("preserves write paths", () => {
		const normalized = normalizeToolInput("Write", { path: "docs/readme.md" });
		expect(normalized.file_path).toBe("docs/readme.md");
	});

	it("records multi-edit edit count", () => {
		const normalized = normalizeToolInput("MultiEdit", {
			path: "src/app.ts",
			edits: [{}, {}, {}],
		});
		expect(normalized.file_path).toBe("src/app.ts");
		expect(normalized.edit_count).toBe(3);
	});

	it("rescues invalid tool names from fallback input", () => {
		expect(
			resolveToolName("invalid", {
				tool: "pair-driver_driverRequestReview",
			}),
		).toBe("mcp__driver__driverRequestReview");
	});

	it("returns null when invalid tool provides no fallback", () => {
		expect(resolveToolName("invalid", {})).toBeNull();
	});

	it("resolves permission tool fallback from metadata", () => {
		expect(
			resolvePermissionToolName("invalid", {
				tool: "pair-driver_driverRequestGuidance",
			}),
		).toBe("mcp__driver__driverRequestGuidance");
	});

	it("returns null when permission metadata lacks usable tool", () => {
		expect(resolvePermissionToolName("invalid", null)).toBeNull();
	});
});
