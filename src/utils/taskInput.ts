/**
 * Task input handling utilities
 */

import readline from "node:readline";

/**
 * Get task from user input (supports multi-line)
 */
export async function getTaskFromUser(): Promise<string> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	console.log("Enter the task for Claude to pair code on.");
	console.log(
		"Type your prompt (can be multiple lines). Press Ctrl+D (Linux/Mac) or Ctrl+Z (Windows) when finished:",
	);
	console.log("");

	return new Promise((resolve) => {
		const lines: string[] = [];

		rl.on("line", (input) => {
			lines.push(input);
		});

		rl.on("close", () => {
			const result = lines.join("\n").trim();
			resolve(result);
		});
	});
}
