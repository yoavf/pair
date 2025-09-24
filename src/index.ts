#!/usr/bin/env node

/**
 * Main entry point for Pair CLI
 */

import { PairApp } from "./app.js";
import { displayBanner } from "./utils/banner.js";
import { parseCliArgs } from "./utils/cli.js";
import { ValidationError } from "./utils/validation.js";

/**
 * Main entry point
 */
async function main(): Promise<void> {
	try {
		const args = process.argv.slice(2);

		// Display banner for normal operations
		displayBanner();

		// Parse CLI arguments and get configuration
		const { projectPath, task, config } = await parseCliArgs(args);

		// Create and start app
		const app = new PairApp(projectPath, task, config);
		await app.start();
	} catch (error) {
		if (error instanceof ValidationError) {
			console.error(`❌ ${error.message}`);
		} else {
			console.error("❌ Fatal error:", error);
		}
	}
}

// Start the application
main();
