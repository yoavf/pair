# Pair

Pair is a CLI utility that orchestrates coding agents working together in a pair programming session. The navigator and driver roles can each run on different providers, including Claude Code and the OpenCode SDK.

## Overview

This tool creates a collaborative coding session with two agent roles working together.

- The session starts with a **Planning** phase where the Navigator formulates a plan.
- The plan is then passed to the Driver for **implementation** with a fresh Navigator instance monitoring.
- The Navigator acts in two moments only:
  - Approving/denying file modifications when the Driver requests an edit (Approve / Deny).
  - Performing a code review when the Driver explicitly asks (CodeReview pass=true|false, then Complete).

The Navigator stays otherwise silent during implementation; the Driver makes actual changes and progresses continuously.

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
pair --dir ~/my-project -p "Add logout functionality"

# Load prompt from file
pair --dir ~/my-project -f prompt.txt
pair -f tasks/feature-request.md

# Use specific providers and models
pair -p "Add tests" --navigator claude-code --navigator-model opus-4.1
pair -p "Refactor" --navigator opencode --navigator-model openrouter/google/gemini-2.5-flash
```

#### Available Options
- `--dir <path>`: Project directory path (default: current directory)
- `-p, --prompt <text>`: Task prompt as text
- `-f, --file <file>`: Load prompt from file (.txt, .md, .json, .yaml, .yml)
- `-v, --verbose`: Enable verbose logging (logs all agent communication)
- `--navigator <provider>`: Set navigator provider (claude-code, opencode)
- `--navigator-model <model>`: Set navigator model
- `--driver <provider>`: Set driver provider
- `--driver-model <model>`: Set driver model
- `--version`: Show version information
- `--help`: Show help message

### Development Usage
```bash
# Run in development mode
npm run dev -- -p "Add logging"
npm run dev -- --dir ~/my-project -p "Add tests"
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

Each role (navigator, driver) can use different providers and models:

#### Available Providers

- `claude-code` (default) - Uses Claude Code SDK
- `opencode` - Uses OpenCode SDK

#### Claude Code Models
- Default: `claude-opus-4.1` for navigator (both planning and monitoring), Sonnet for driver
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
  --navigator opencode --navigator-model openrouter/google/gemini-2.5-flash \
  --navigator claude-code --navigator-model opus-4.1 \
  --driver claude-code

# All OpenCode
pair -p "Refactor" \
  --navigator opencode --navigator-model openai/gpt-4 \
  --navigator opencode --navigator-model openrouter/anthropic/claude-opus-4.1 \
  --driver opencode --driver-model openrouter/google/gemini-2.5-flash
```

#### OpenCode Configuration

When using OpenCode, configure the server with:

- `OPENCODE_BASE_URL` (defaults to `http://127.0.0.1:4096`)
- Server handles model configuration automatically based on your CLI arguments
- `OPENCODE_AGENT_NAVIGATOR`, `OPENCODE_AGENT_DRIVER` if you created custom sub-agents with tailored prompts
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
  - `error`: Log only errors
  - `warn`: Log warnings and errors
  - `info`: Log general information, tools usage
  - `debug`: Enable detailed session logging
  - `verbose`: Enable verbose logging of all agent communication data
- `-v, --verbose`: Command-line flag to enable verbose logging of all agent communication data

When enabled, logs are written to `~/.pair/logs/pair-debug.log` in JSONL format (one JSON object per line)

#### Log Format
The logger now uses JSONL format for easier parsing and analysis:
- Each log entry is a single JSON object on its own line
- Includes timestamp, event type, and relevant data
- In verbose mode, includes full agent communication data
- In normal mode, data is truncated to reasonable lengths

Example:
```bash
# Enable verbose logging via CLI
pair -v -p "Add logging"

# View logs (each line is a JSON object)
tail -f ~/.pair/logs/pair-debug.log | jq '.'
```

#### Log Event Types
- `SESSION_START`: Initial log entry with session info
- `EVENT`: General events in the application
- `TOOL_USE`: Tool invocations by agents
- `TOOL_RESULT`: Results from tool executions
- `NAVIGATOR_SESSION`: Navigator agent messages (verbose mode)
- `DRIVER_SESSION`: Driver agent messages (verbose mode)
- `AGENT_COMMUNICATION`: Inter-agent communication (verbose mode)
- `STATE_CHANGE`: Application state changes

Example:
```bash
# Enable debug logging in development
LOG_LEVEL=debug npm run dev -- -p "Add tests"

# Enable debug logging
LOG_LEVEL=debug pair --dir ~/my-project -p "Add tests"

# Disable sync status for clean recordings
CLAUDE_PAIR_DISABLE_SYNC_STATUS=true pair -p "Add authentication"
```

### Example Usage with Configuration
```bash
# Give navigator more turns for complex tasks
CLAUDE_PAIR_NAVIGATOR_MAX_TURNS=75 \
  pair --dir ~/my-project -p "Complex refactoring task"

# Use different turn limits
CLAUDE_PAIR_NAVIGATOR_MAX_TURNS=30 CLAUDE_PAIR_DRIVER_MAX_TURNS=10 \
  pair --dir ~/project -f task.md

# Use specific models for different roles
pair --dir ~/project -p "Complex architectural task" \
  --navigator claude-code --navigator-model claude-opus-4-1-20250805 \
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
│   ├── Navigator.ts            # Planning and monitoring agent
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
- Claude Code SDK (`@anthropic-ai/claude-agent-sdk`)
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
