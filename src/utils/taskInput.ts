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
	console.log("(Use \\ + Enter for line breaks, or just Enter to submit)");
	console.log("");

	return new Promise((resolve) => {
		const lines: string[] = [];

		const promptForInput = () => {
			const prompt = lines.length === 0 ? "> " : "  ";
			rl.question(prompt, (input) => {
				// Check if input ends with \ for line continuation
				if (input.endsWith("\\")) {
					// Remove the trailing \ and add this line
					lines.push(input.slice(0, -1));
					// Continue to next line
					promptForInput();
				} else {
					// Add the final line and submit
					lines.push(input);
					rl.close();
					const result = lines.join("\n").trim();
					resolve(result);
				}
			});
		};

		promptForInput();
	});
}
