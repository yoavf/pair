# Pair

Pair is a CLI utility that orchestrates coding agents working together in a pair programming session. The architect, navigator, and driver roles can each run on different providers, including Claude Code and the OpenCode SDK.

## Overview

This tool creates a collaborative coding session with two agent instances working together.

- The session starts with a **Planning** phase where a plan is formulated by the Architect.
- The plan is then passed to the Driver for **implementation**.
- The Navigator acts in two moments only:
  - Approving/denying file modifications when the Driver requests an edit (Approve / Deny).
  - Performing a code review when the Driver explicitly asks (CodeReview pass=true|false, then Complete).

The Navigator stays otherwise silent; the Driver makes actual changes and progresses continuously.

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd pair

# Install dependencies
npm install

# Build the TypeScript code
npm run build

# Optional: Install globally
npm link
```

## Usage

### Basic Usage

```bash
# Run with a prompt (uses Claude Code with default models)
pair -p "Add user authentication"

# Run with a prompt and specify project path
pair --path ~/my-project -p "Add logout functionality"

# Load prompt from file
pair --path ~/my-project -f prompt.txt
pair -f tasks/feature-request.md

# Use specific providers and models
pair -p "Add tests" --architect claude-code --architect-model opus-4.1
pair -p "Refactor" --navigator opencode --navigator-model openrouter/google/gemini-2.5-flash
```

#### Available Options
- `--path <path>`: Project directory path (default: current directory)
- `-p, --prompt <text>`: Task prompt as text
- `-f, --file <file>`: Load prompt from file (.txt, .md, .json, .yaml, .yml)
- `--architect <provider>`: Set architect provider (claude-code, opencode)
- `--architect-model <model>`: Set architect model
- `--navigator <provider>`: Set navigator provider
- `--navigator-model <model>`: Set navigator model
- `--driver <provider>`: Set driver provider
- `--driver-model <model>`: Set driver model
- `--version`: Show version information
- `--help`: Show help message

### Development Usage
```bash
# Run in development mode
npm run dev -- -p "Add logging"
npm run dev -- --path ~/my-project -p "Add tests"
```

## Configuration

You can customize behavior using environment variables:

### Environment Variables
- `CLAUDE_PAIR_NAVIGATOR_MAX_TURNS`: Maximum turns for navigator (default: 50)
- `CLAUDE_PAIR_DRIVER_MAX_TURNS`: Maximum turns for driver (default: 20)
- `CLAUDE_PAIR_MAX_PROMPT_LENGTH`: Maximum prompt length in characters (default: 10000)
- `CLAUDE_PAIR_MAX_PROMPT_FILE_SIZE`: Maximum prompt file size in bytes (default: 102400 = 100KB)
- `CLAUDE_PAIR_SESSION_HARD_LIMIT_MIN`: Hard execution time limit in minutes (default: 30)
- `CLAUDE_PAIR_DISABLE_SYNC_STATUS`: Set to "true" to disable sync status updates in footer (useful for clean recordings)

When the session hard limit is reached during execution, a short notice appears in the footer and both sessions are shut down gracefully.

### Agent Providers and Models

Each role (architect, navigator, driver) can use different providers and models:

#### Available Providers

- `claude-code` (default) - Uses Claude Code SDK
- `opencode` - Uses OpenCode SDK

#### Claude Code Models
- Default: `claude-opus-4.1` for architect, Sonnet for navigator/driver
- Can specify: `opus-4.1`, `sonnet`, etc.

#### OpenCode Models
- **Required**: Must specify model in format `provider/model`
- Examples: `openrouter/google/gemini-2.5-flash`, `openai/gpt-4`, `anthropic/claude-opus-4.1`

#### Configuration Examples

```bash
# Default (Claude Code)
pair -p "Add feature"

# Mixed providers
pair -p "Add tests" \
  --architect opencode --architect-model openrouter/google/gemini-2.5-flash \
  --navigator claude-code --navigator-model opus-4.1 \
  --driver claude-code

# All OpenCode
pair -p "Refactor" \
  --architect opencode --architect-model openai/gpt-4 \
  --navigator opencode --navigator-model openrouter/anthropic/claude-opus-4.1 \
  --driver opencode --driver-model openrouter/google/gemini-2.5-flash
```

#### OpenCode Configuration

When using OpenCode, configure the server with:

- `OPENCODE_BASE_URL` (defaults to `http://127.0.0.1:4096`)
- Server handles model configuration automatically based on your CLI arguments
- `OPENCODE_AGENT_ARCHITECT`, `OPENCODE_AGENT_NAVIGATOR`, `OPENCODE_AGENT_DRIVER` if you created custom sub-agents with tailored prompts
- `OPENCODE_START_SERVER=false` if you want to connect to an existing OpenCode deployment instead of auto-starting a local instance

**Note**: Environment variables for providers are deprecated. Use command-line arguments instead:

```bash
# Old way (deprecated)
CLAUDE_PAIR_DRIVER_PROVIDER=opencode pair -p "Fix tests"

# New way (recommended)
pair -p "Fix tests" --driver opencode --driver-model openrouter/google/gemini-2.5-flash
```

When `opencode` is on your PATH, the provider will automatically launch a local server (`opencode serve`) on `127.0.0.1:4096`. Override the hostname/port with `OPENCODE_HOSTNAME`, `OPENCODE_PORT`, or turn it off entirely with `OPENCODE_START_SERVER=false` and point `OPENCODE_BASE_URL` to a running instance.

### Debugging and Logging
- `LOG_LEVEL`: Enable file logging (default: disabled)
  - `debug`: Enable detailed session logging

When enabled, logs are written to `~/.pair/logs/pair-debug.log`

Example:
```bash
# Enable debug logging in development
LOG_LEVEL=debug npm run dev -- -p "Add tests"

# Enable debug logging
LOG_LEVEL=debug pair --path ~/my-project -p "Add tests"

# Disable sync status for clean recordings
CLAUDE_PAIR_DISABLE_SYNC_STATUS=true pair -p "Add authentication"
```

### Example Usage with Configuration
```bash
# Give navigator more turns for complex tasks
CLAUDE_PAIR_NAVIGATOR_MAX_TURNS=75 \
  pair --path ~/my-project -p "Complex refactoring task"

# Use different turn limits
CLAUDE_PAIR_NAVIGATOR_MAX_TURNS=30 CLAUDE_PAIR_DRIVER_MAX_TURNS=10 \
  pair --path ~/project -f task.md

# Use specific models for different roles
pair --path ~/project -p "Complex architectural task" \
  --architect claude-code --architect-model claude-opus-4-1-20250805 \
  --navigator opencode --navigator-model openrouter/google/gemini-2.5-flash

```

When you start the application:

1. You will be prompted to enter a task for the pair to work on
2. The terminal will display a scrolling list of messages as both agents collaborate
3. Both agents will begin collaborating on the task

### Keyboard Shortcuts

- `Ctrl+C` - Quit the application (twice)

## Architecture

```
src/
├── index.ts                    # Main entry point
├── app.ts                      # Application orchestration
├── conversations/              # Agent implementations
│   ├── Architect.ts            # Planning agent
│   ├── Driver.ts               # Implementation agent
│   ├── Navigator.ts            # Review agent
│   └── navigator/              # Navigator utilities
├── providers/                  # Provider implementations
│   ├── embedded/               # In-process providers
│   │   ├── claudeCode.ts       # Claude Code provider
│   │   ├── opencode.ts         # OpenCode provider
│   │   └── opencode/           # OpenCode modules
│   └── factory.ts              # Provider factory
├── utils/                      # Helper functions
│   ├── cli.ts                  # CLI argument parsing
│   ├── config.ts               # Configuration management
│   ├── implementationLoop.ts   # Core implementation logic
│   └── ...                     # Other utilities
├── components/                 # UI components
├── display.tsx                 # Display management
└── types/                      # Type definitions
```

## Requirements

- Node.js 18+
- Claude Code SDK (`@anthropic-ai/claude-code`)
- OpenCode SDK (`@opencode-ai/sdk`) when using the OpenCode provider
- OpenCode CLI (`opencode`) on your PATH if you rely on Pair to auto-start the OpenCode server
- Valid Anthropic API key configured

## Notes

- Uses your existing Claude authentication when the provider is Claude Code. If Claude isn't configured, run `claude` first to set up authentication
- The two agents can occasionally get into repetitive back‑and‑forth (an implicit "infinite loop"). A hard time limit is enforced for the execution phase (30 minutes by default). You can adjust or disable it via the environment variables documented above.

## Demo

[![asciicast](https://asciinema.org/a/740961.svg)](https://asciinema.org/a/740961)

## License

Apache 2.0
