/**
 * CLI argument parsing and help utilities
 */

import { agentProviderFactory } from "../providers/factory.js";
import { type AppConfig, loadConfig, validateConfig } from "./config.js";
import {
	validateAndReadPromptFile,
	validateAndSanitizePath,
	validateCliArgs,
	validatePrompt,
} from "./validation.js";
import { getVersion } from "./version.js";

export interface ParsedCliArgs {
	projectPath: string;
	task: string;
	config: AppConfig;
}

/**
 * Display help message
 */
export function showHelp(): void {
	console.log("Usage: pair [options]");
	console.log("\nAvailable options:");
	console.log("  -p, --prompt <text>           Specify the task prompt");
	console.log(
		"  --path <path>                 Set the project path (default: current directory)",
	);
	console.log("  -f, --file <file>             Read prompt from file");
	console.log(
		"  --architect <provider>        Set architect provider (claude-code, opencode)",
	);
	console.log("  --architect-model <model>     Set architect model");
	console.log("  --navigator <provider>        Set navigator provider");
	console.log("  --navigator-model <model>     Set navigator model");
	console.log("  --driver <provider>           Set driver provider");
	console.log("  --driver-model <model>        Set driver model");
	console.log("  --version                     Show version information");
	console.log("  --help                        Show this help message");
	console.log("\nExamples:");
	console.log("  # Use defaults (Claude Code with default models)");
	console.log('  pair -p "Add dark mode toggle"');
	console.log("");
	console.log("  # Use Claude Code with specific model for architect");
	console.log(
		'  pair -p "Refactor auth" --architect claude-code --architect-model opus-4.1',
	);
	console.log("");
	console.log(
		"  # Mix providers: OpenCode for architect, Claude Code for others",
	);
	console.log(
		'  pair -p "Add tests" --architect opencode --architect-model openrouter/google/gemini-2.5-flash',
	);
}

/**
 * Parse command line arguments and return configuration
 */
export async function parseCliArgs(args: string[]): Promise<ParsedCliArgs> {
	const config = loadConfig();
	validateConfig(config, agentProviderFactory.getAvailableProviders());

	// Handle --version flag
	if (args.includes("--version") || args.includes("-v")) {
		console.log(getVersion());
		process.exit(0);
	}

	// Handle --help flag
	if (args.includes("--help") || args.includes("-h")) {
		showHelp();
		process.exit(0);
	}

	// Handle 'help' command
	if (args.length === 1 && args[0] === "help") {
		showHelp();
		process.exit(0);
	}

	validateCliArgs(args);

	let projectPath = process.cwd();
	let initialPrompt: string | undefined;
	let promptFile: string | undefined;

	// Parse arguments
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--path") {
			if (i + 1 < args.length) {
				projectPath = args[i + 1];
				i++;
			}
		} else if (arg.startsWith("--path=")) {
			projectPath = arg.split("=")[1];
		} else if (arg === "--prompt" || arg === "-p") {
			if (i + 1 < args.length) {
				initialPrompt = args[i + 1];
				i++;
			}
		} else if (arg.startsWith("--prompt=")) {
			initialPrompt = arg.substring("--prompt=".length);
		} else if (arg === "--file" || arg === "-f") {
			if (i + 1 < args.length) {
				promptFile = args[i + 1];
				i++;
			}
		} else if (arg.startsWith("--file=")) {
			promptFile = arg.split("=")[1];
		} else if (arg === "--architect") {
			if (i + 1 < args.length) {
				config.architectConfig.provider = args[i + 1];
				i++;
			}
		} else if (arg.startsWith("--architect=")) {
			config.architectConfig.provider = arg.substring("--architect=".length);
		} else if (arg === "--architect-model") {
			if (i + 1 < args.length) {
				config.architectConfig.model = args[i + 1];
				i++;
			}
		} else if (arg.startsWith("--architect-model=")) {
			config.architectConfig.model = arg.substring("--architect-model=".length);
		} else if (arg === "--navigator") {
			if (i + 1 < args.length) {
				config.navigatorConfig.provider = args[i + 1];
				i++;
			}
		} else if (arg.startsWith("--navigator=")) {
			config.navigatorConfig.provider = arg.substring("--navigator=".length);
		} else if (arg === "--navigator-model") {
			if (i + 1 < args.length) {
				config.navigatorConfig.model = args[i + 1];
				i++;
			}
		} else if (arg.startsWith("--navigator-model=")) {
			config.navigatorConfig.model = arg.substring("--navigator-model=".length);
		} else if (arg === "--driver") {
			if (i + 1 < args.length) {
				config.driverConfig.provider = args[i + 1];
				i++;
			}
		} else if (arg.startsWith("--driver=")) {
			config.driverConfig.provider = arg.substring("--driver=".length);
		} else if (arg === "--driver-model") {
			if (i + 1 < args.length) {
				config.driverConfig.model = args[i + 1];
				i++;
			}
		} else if (arg.startsWith("--driver-model=")) {
			config.driverConfig.model = arg.substring("--driver-model=".length);
		} else if (!arg.startsWith("-")) {
			if (projectPath === process.cwd()) {
				projectPath = arg;
			}
		}
	}

	// Validate project path
	projectPath = validateAndSanitizePath(projectPath);

	// Get task
	let task: string;

	if (promptFile) {
		task = validateAndReadPromptFile(promptFile);
	} else if (initialPrompt) {
		task = validatePrompt(initialPrompt, config.maxPromptLength);
	} else {
		const { getTaskFromUser } = await import("./taskInput.js");
		task = await getTaskFromUser();
	}

	// Final validation after CLI overrides
	validateConfig(config, agentProviderFactory.getAvailableProviders());

	return {
		projectPath,
		task,
		config,
	};
}
