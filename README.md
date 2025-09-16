# Pair(claude)

Pair is a CLI utility to run two Claude instances in pair programming mode. This experimental CLI application orchestrates two Claude Code instances working together in a pair programming session.

## Overview

This tool creates a collaborative coding session with two Claude instances working together.

- The session starts with a **Planning** phase where a plan is formulated by the Navigator.
- The plan is then passed to the Driver for **implementation**.
- The Navigator acts in two moments only:
  - Approving/denying file modifications when the Driver requests an edit (Approve / ApproveAlways / Deny). It may add a single short feedback line after approvals.
  - Performing a code review when the Driver explicitly asks using `{{RequestReview}}` (CodeReview pass=true|false, then Complete).

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
- `CLAUDE_PAIR_MODEL`: Claude model to use (default: uses CLI configuration)
- `CLAUDE_PAIR_SESSION_HARD_LIMIT_MIN`: Hard execution time limit in minutes (default: 30)
- `CLAUDE_PAIR_DISABLE_SYNC_STATUS`: Set to "true" to disable sync status updates in footer (useful for clean recordings)

When the session hard limit is reached during execution, a short notice appears in the footer and both sessions are shut down gracefully.

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
2. The terminal will display a scrolling list of messages as both Claude instances collaborate
3. Both Claude instances will begin collaborating on the task

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
- Valid Anthropic API key configured

## Notes

- Uses your existing Claude authentication. If Claude isn't configured, run `claude` first to set up authentication
- Uses mock tools (text-based commands like `{{Nod}}`, `{{Feedback}}`) due to a current Claude Code SDK limitation with streaming mode and tools. See [issue #6710](https://github.com/anthropics/claude-code/issues/6710)
- The two agents can occasionally get into repetitive back‑and‑forth (an implicit "infinite loop"). A hard time limit is enforced for the execution phase (30 minutes by default). You can adjust or disable it via the environment variables documented above.

## Demo

[![asciicast](https://asciinema.org/a/740961.svg)](https://asciinema.org/a/740961)

## MCP/Tools Playground (Standalone)

Use the standalone script to validate streaming and tool behavior in isolation before wiring into the CLI:

- Claude Code tools (streaming + built-ins):
  - `npm run dev -- tsx src/standalone/mcp-playground.ts --mode=claude-code -p "Scan repo and list key files"`
  - Optional: `--cwd /path/to/project` to run tools against another folder

- Anthropic SDK + custom tool (non-streaming, baseline tool_use check):
  - `export ANTHROPIC_API_KEY=...`
  - `npm run dev -- tsx src/standalone/mcp-playground.ts --mode=anthropic-sdk -p "Summarize the repo; call echo tool"`

Once we confirm the latest SDK streaming + tools are stable, we’ll extend this script to attach MCP servers and surface them as tools for Claude.

## License

Apache 2.0
