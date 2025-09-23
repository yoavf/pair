# Pair

Pair is a CLI utility that orchestrates coding agents (default: Claude Code) working together in a pair programming session. The driver and navigator roles can now be backed by different providers, including the OpenCode SDK.

## Overview

This tool creates a collaborative coding session with two agent instances working together.

- The session starts with a **Planning** phase where a plan is formulated by the Navigator.
- The plan is then passed to the Driver for **implementation**.
- The Navigator acts in two moments only:
  - Approving/denying file modifications when the Driver requests an edit (Approve / Deny).
  - Performing a code review when the Driver explicitly asks (CodeReview pass=true|false, then Complete).

The Navigator stays otherwise silent; the Driver makes actual changes and progresses continuously.

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd pair-claude

# Install dependencies
npm install

# Build the TypeScript code
npm run build

# Optional: Install globally
npm link
```

## Usage

### Basic Usage

Prefix `claude` with `pair`: `pair claude`, adding the following optional arguments:

```bash
# Run with a prompt
pair claude -p "Add user authentication"

# Run with a prompt and specify project path
pair claude --path ~/my-project -p "Add logout functionality"

# Load prompt from file
pair claude --path ~/my-project -f prompt.txt
pair claude -f tasks/feature-request.md

# Alternative syntax with equals
pair claude --path=~/my-project --prompt="Add authentication"
pair claude --path=~/my-project --file=prompt.txt
```

#### Available Options
- `--path`: Project directory path (default: current directory)
- `-p, --prompt`: Task prompt as text
- `-f, --file`: Load prompt from file (.txt, .md, .json, .yaml, .yml)
- `--version`: Show version information

### Development Usage
```bash
# Run in development mode
npm run dev -- claude -p "Add logging"
npm run dev -- claude --path ~/my-project -p "Add tests"
```

## Configuration

You can customize behavior using environment variables:

### Environment Variables
- `CLAUDE_PAIR_NAVIGATOR_MAX_TURNS`: Maximum turns for navigator (default: 50)
- `CLAUDE_PAIR_DRIVER_MAX_TURNS`: Maximum turns for driver (default: 20)
- `CLAUDE_PAIR_MAX_PROMPT_LENGTH`: Maximum prompt length in characters (default: 10000)
- `CLAUDE_PAIR_MAX_PROMPT_FILE_SIZE`: Maximum prompt file size in bytes (default: 102400 = 100KB)
- `CLAUDE_PAIR_MODEL`: Claude model to use when the provider is Claude Code (default: uses CLI configuration)
- `CLAUDE_PAIR_SESSION_HARD_LIMIT_MIN`: Hard execution time limit in minutes (default: 30)
- `CLAUDE_PAIR_DISABLE_SYNC_STATUS`: Set to "true" to disable sync status updates in footer (useful for clean recordings)

When the session hard limit is reached during execution, a short notice appears in the footer and both sessions are shut down gracefully.

### Agent Providers

Each role can target a different provider by setting:

- `CLAUDE_PAIR_ARCHITECT_PROVIDER`
- `CLAUDE_PAIR_NAVIGATOR_PROVIDER`
- `CLAUDE_PAIR_DRIVER_PROVIDER`

Available values:

- `claude-code` (default)
- `opencode`

When using the OpenCode provider, make sure an OpenCode server is running and configure it with:

- `OPENCODE_BASE_URL` (defaults to `http://127.0.0.1:4096`)
- `OPENCODE_MODEL_PROVIDER` / `OPENCODE_MODEL_ID` for the underlying LLM
- `OPENCODE_AGENT_ARCHITECT`, `OPENCODE_AGENT_NAVIGATOR`, `OPENCODE_AGENT_DRIVER` if you created custom sub-agents with tailored prompts
- `OPENCODE_START_SERVER=false` if you want to connect to an existing OpenCode deployment instead of auto-starting a local instance

Example:

```bash
CLAUDE_PAIR_DRIVER_PROVIDER=opencode \
CLAUDE_PAIR_NAVIGATOR_PROVIDER=opencode \
OPENCODE_BASE_URL=http://localhost:4096 \
pair claude --path ~/project -p "Fix flaky tests"
```

When `opencode` is on your PATH, the provider will automatically launch a local server (`opencode serve`) on `127.0.0.1:4096`. Override the hostname/port with `OPENCODE_HOSTNAME`, `OPENCODE_PORT`, or turn it off entirely with `OPENCODE_START_SERVER=false` and point `OPENCODE_BASE_URL` to a running instance.

### Debugging and Logging
- `LOG_LEVEL`: Enable file logging (default: disabled)
  - `debug`: Enable detailed session logging

When enabled, logs are written to `~/.claude-pair/logs/claude-pair-debug.log`

Example:
```bash
# Enable debug logging in development
LOG_LEVEL=debug npm run dev -- claude -p "Add tests"

# Enable debug logging
LOG_LEVEL=debug pair claude --path ~/my-project -p "Add tests"

# Disable sync status for clean recordings
CLAUDE_PAIR_DISABLE_SYNC_STATUS=true pair claude -p "Add authentication"
```

### Example Usage with Configuration
```bash
# Give navigator more turns for complex tasks
CLAUDE_PAIR_NAVIGATOR_MAX_TURNS=75 \
  pair claude --path ~/my-project -p "Complex refactoring task"

# Use different turn limits
CLAUDE_PAIR_NAVIGATOR_MAX_TURNS=30 CLAUDE_PAIR_DRIVER_MAX_TURNS=10 \
  pair claude --path ~/project -f task.md

# Use a specific Claude model
CLAUDE_PAIR_MODEL=claude-3-opus-20240229 \
  pair claude --path ~/project -p "Complex architectural task"

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
├── index.ts                    # Main orchestrator
├── conversations/              # Agent implementations
├── components/                 # UI components
├── utils/                      # Helper functions
├── config.ts                   # Configuration
└── types.ts                    # Type definitions
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
