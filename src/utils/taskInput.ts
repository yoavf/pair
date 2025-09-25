/**
 * Task input handling utilities
 */

import readline from "node:readline";

/**
 * Get task from user input
 */
export async function getTaskFromUser(): Promise<string> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question("Enter the task for Claude to pair code on:\n> ", (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}
