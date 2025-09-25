/**
 * CLI argument parsing and help utilities
 */

import { Command } from "commander";
import { agentProviderFactory } from "../providers/factory.js";
import { type AppConfig, loadConfig, validateConfig } from "./config.js";
import {
	validateAndReadPromptFile,
	validateAndSanitizePath,
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
	const program = createProgram();
	program.help();
}

/**
 * Create and configure the Commander.js program
 */
function createProgram(): Command {
	const program = new Command();

	program
		.name("pair")
		.description("AI pair programming CLI that orchestrates coding agents")
		.version(getVersion())
		.requiredOption("-p, --prompt <text>", "Task prompt to implement")
		.option("-d, --dir <path>", "Project directory", process.cwd())
		.option("-f, --file <file>", "Read prompt from file (overrides --prompt)")
		.option("--architect <provider>", "Architect provider", "claude-code")
		.option("--architect-model <model>", "Architect model")
		.option("--navigator <provider>", "Navigator provider", "claude-code")
		.option("--navigator-model <model>", "Navigator model")
		.option("--driver <provider>", "Driver provider", "claude-code")
		.option("--driver-model <model>", "Driver model")
		.addHelpText(
			"after",
			`
Examples:
  pair -p "Add dark mode toggle"
  pair -p "Refactor auth" --architect-model opus-4.1
  pair -f task.txt --dir ./my-project
  pair -p "Add tests" --architect opencode --architect-model openrouter/google/gemini-2.5-flash`,
		);

	return program;
}

/**
 * Parse command line arguments and return configuration
 */
export async function parseCliArgs(args: string[]): Promise<ParsedCliArgs> {
	const config = loadConfig();
	validateConfig(config, agentProviderFactory.getAvailableProviders());

	const program = createProgram();
	program.parse(args, { from: "user" });
	const options = program.opts();

	// Apply CLI overrides to config
	config.architectConfig.provider = options.architect;
	if (options.architectModel) {
		config.architectConfig.model = options.architectModel;
	}
	config.navigatorConfig.provider = options.navigator;
	if (options.navigatorModel) {
		config.navigatorConfig.model = options.navigatorModel;
	}
	config.driverConfig.provider = options.driver;
	if (options.driverModel) {
		config.driverConfig.model = options.driverModel;
	}

	// Validate and sanitize project path
	const projectPath = validateAndSanitizePath(options.dir);

	// Get task (file overrides prompt)
	let task: string;
	if (options.file) {
		task = validateAndReadPromptFile(options.file);
	} else {
		task = validatePrompt(options.prompt, config.maxPromptLength);
	}

	// Final validation after CLI overrides
	validateConfig(config, agentProviderFactory.getAvailableProviders());

	return {
		projectPath,
		task,
		config,
	};
}
