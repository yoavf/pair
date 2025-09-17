import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Get the current version from package.json
 */
export function getVersion(): string {
	try {
		// Get the directory of the current module
		const currentDir = dirname(fileURLToPath(import.meta.url));
		// Go up to the project root and read package.json
		const packageJsonPath = join(currentDir, "../../package.json");
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
		return packageJson.version || "unknown";
	} catch (error) {
		console.error("Warning: Could not read version from package.json:", error);
		return "unknown";
	}
}
