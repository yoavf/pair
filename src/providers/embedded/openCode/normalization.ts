const PERMISSION_TOOL_NAME_MAP: Record<string, string> = {
	bash: "Bash",
	edit: "Edit",
	glob: "Glob",
	grep: "Grep",
	list: "Glob",
	multiedit: "MultiEdit",
	patch: "Patch",
	read: "Read",
	todoread: "TodoRead",
	todowrite: "TodoWrite",
	task: "Task",
	test: "Test",
	webfetch: "WebFetch",
	websearch: "WebSearch",
	write: "Write",
	"pair-driver_driverRequestReview": "mcp__driver__driverRequestReview",
	"pair-driver_driverRequestGuidance": "mcp__driver__driverRequestGuidance",
	"pair-navigator_navigatorCodeReview": "mcp__navigator__navigatorCodeReview",
	"pair-navigator_navigatorComplete": "mcp__navigator__navigatorComplete",
	"pair-navigator_navigatorApprove": "mcp__navigator__navigatorApprove",
	"pair-navigator_navigatorDeny": "mcp__navigator__navigatorDeny",
	// Special planning tool for architect
	exitplanmode: "ExitPlanMode",
};

export function mapPermissionType(type: string): string | null {
	return PERMISSION_TOOL_NAME_MAP[type] ?? null;
}

export function mapPartToolName(tool: string): string | null {
	return PERMISSION_TOOL_NAME_MAP[tool] ?? tool;
}

export function resolveToolName(tool: string, input: unknown): string | null {
	let candidate = tool;
	if (
		candidate === "invalid" &&
		input &&
		typeof input === "object" &&
		"tool" in (input as Record<string, unknown>)
	) {
		const fallback = (input as Record<string, unknown>).tool;
		if (typeof fallback === "string" && fallback.trim().length > 0) {
			candidate = fallback;
		}
	}

	if (candidate === "invalid") {
		return null;
	}

	return mapPartToolName(candidate);
}

export function resolvePermissionToolName(
	type: string,
	metadata?: Record<string, unknown> | null,
): string | null {
	const primary = mapPermissionType(type);
	if (primary && primary !== "invalid") {
		return primary;
	}

	if (metadata && typeof metadata === "object") {
		const fallback = metadata.tool;
		if (typeof fallback === "string" && fallback.trim().length > 0) {
			const mappedFallback = mapPermissionType(fallback);
			if (mappedFallback && mappedFallback !== "invalid") {
				return mappedFallback;
			}
			if (fallback !== "invalid") {
				return fallback;
			}
		}
	}

	return null;
}

function normalizeToolBaseName(tool: string): string {
	if (tool.startsWith("mcp__")) {
		const parts = tool.split("__");
		return parts[parts.length - 1].toLowerCase();
	}
	if (tool.startsWith("pair-driver_")) {
		return tool.slice("pair-driver_".length).toLowerCase();
	}
	if (tool.startsWith("pair-navigator_")) {
		return tool.slice("pair-navigator_".length).toLowerCase();
	}
	return tool.toLowerCase();
}

export function normalizeToolInput(
	tool: string,
	input: unknown,
): Record<string, unknown> {
	if (!input || typeof input !== "object") {
		return {};
	}
	const original = input as Record<string, unknown>;
	const normalized: Record<string, unknown> = { ...original };
	const baseName = normalizeToolBaseName(tool);

	const coalescePath = (...keys: string[]): string | undefined => {
		for (const key of keys) {
			const value = original[key];
			if (typeof value === "string" && value.trim().length > 0) {
				return value;
			}
		}
		return undefined;
	};

	if (baseName === "read") {
		const filePath = coalescePath(
			"file_path",
			"filePath",
			"path",
			"file",
			"target",
		);
		if (filePath) {
			normalized.file_path = filePath;
		}
	} else if (baseName === "edit") {
		const filePath = coalescePath("file_path", "filePath", "path", "file");
		if (filePath) normalized.file_path = filePath;
		const oldString = original.old_string ?? original.oldString;
		if (typeof oldString === "string") {
			normalized.old_string = oldString;
		}
		const newString = original.new_string ?? original.newString;
		if (typeof newString === "string") {
			normalized.new_string = newString;
		}
	} else if (baseName === "write") {
		const filePath = coalescePath("file_path", "filePath", "path", "file");
		if (filePath) normalized.file_path = filePath;
	} else if (baseName === "multiedit") {
		const filePath = coalescePath("file_path", "filePath", "path", "file");
		if (filePath) normalized.file_path = filePath;
		const edits = original.edits;
		if (Array.isArray(edits)) {
			normalized.edit_count = edits.length;
		}
	} else if (baseName === "glob" || baseName === "list") {
		const pathValue = coalescePath("path", "directory", "dir");
		if (pathValue) normalized.path = pathValue;
		if (typeof original.pattern === "string") {
			normalized.pattern = original.pattern;
		}
	}

	return normalized;
}

export const __openCodeTestUtils = {
	mapPartToolName,
	normalizeToolInput,
	resolveToolName,
	resolvePermissionToolName,
};
