/**
 * Task input handling utilities
 */

import readline from "node:readline";

/**
 * Get task from user input (supports multi-line)
 */
export async function getTaskFromUser(): Promise<string> {
	console.log("Enter your prompt to launch a pair-coding session");
	console.log("");

	return new Promise((resolve) => {
		const lines: string[] = [];
		let currentInput = "";

		// Enable raw mode to capture individual keystrokes
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(true);
		}
		process.stdin.resume();
		process.stdin.setEncoding("utf8");

		const writePrompt = () => {
			const prompt = lines.length === 0 ? "> " : "  ";
			process.stdout.write(prompt);
		};

		const cleanup = () => {
			process.stdin.removeAllListeners("data");
			if (process.stdin.isTTY) {
				process.stdin.setRawMode(false);
			}
			process.stdin.pause();
		};

		writePrompt();

		process.stdin.on("data", (key: Buffer) => {
			const char = key.toString();
			const bytes = [...key];

			// Detect special key combinations
			// Shift+Enter: often comes as \r\n or standalone \n
			// Regular Enter: \r or \n

			if (char === "\r\n" || (char === "\n" && bytes.length === 1)) {
				// Shift+Enter on some terminals - force line break
				lines.push(currentInput);
				process.stdout.write("\n");
				currentInput = "";
				writePrompt();
			} else if (char === "\r" || char === "\n") {
				// Regular Enter
				if (currentInput.endsWith("\\")) {
					// Backslash continuation - remove backslash and go to next line
					const lineWithoutBackslash = currentInput.slice(0, -1);
					lines.push(lineWithoutBackslash);

					// Clear current line and rewrite without backslash
					process.stdout.write("\r");
					process.stdout.write(
						" ".repeat(
							(lines.length === 0 ? "> " : "  ").length + currentInput.length,
						),
					);
					process.stdout.write("\r");
					const prompt = lines.length === 0 ? "> " : "  ";
					process.stdout.write(prompt + lineWithoutBackslash + "\n");

					currentInput = "";
					writePrompt();
				} else {
					// Submit input
					lines.push(currentInput);
					process.stdout.write("\n");
					cleanup();
					const result = lines.join("\n").trim();
					resolve(result);
				}
			} else if (char === "\u0003") {
				// Ctrl+C
				cleanup();
				process.exit(0);
			} else if (char === "\u007f" || char === "\b") {
				// Backspace
				if (currentInput.length > 0) {
					currentInput = currentInput.slice(0, -1);
					process.stdout.write("\b \b");
				}
			} else if (char >= " " || char === "\t") {
				// Printable character or tab
				currentInput += char;
				process.stdout.write(char);
			}
		});
	});
}
