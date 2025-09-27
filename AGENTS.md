# Pair Repository Guidelines

Pair is a CLI utility to run coding agents in pair programming mode.

## Project Structure & Module Organization
- `src/` TypeScript sources (ES modules):
  - `index.ts` CLI entry and orchestration
  - `components/` Ink + React UI (PascalCase files, `.tsx`)
  - `conversations/` role agents: `Navigator`, `Driver`
  - `utils/` helpers (`config`, `planManager`, `logger`, etc.)
  - `hooks/` React/Ink hooks (e.g., `useMessages`)
  - `display.tsx`, `config.ts`, `types.ts`
- `dist/` build output (generated). Do not edit.
- Key docs: `README.md`, `DATA_FLOW.md`, `CLAUDE.md`.

## Build, Test, and Development Commands
- `npm run build` — Compile TypeScript to `dist/` via `tsc`.
- `npm start` — Run compiled CLI (`node dist/index.js`).
- `npm run dev` — Run in watchless dev using `tsx` (no build).
- `npm run watch` — Type-check and rebuild on file changes.
- Example: `npm run dev -- --dir . -p "Add logging"`.

## Architecture & Agent Behavior
- Navigator (planning): Creates the initial plan in a non-interactive planning phase, then exits after returning plan via ExitPlanMode.
- Navigator (monitoring): Reviews and approves/denies Driver's file modifications and performs code reviews using read‑only tools (Read/Grep/Glob/WebSearch/WebFetch/Bash) in a fresh session.
- Driver (implement): Implements changes with full tool access, coordinated with navigator approvals.
- Communication: structured commands facilitate coordination between agents with visual transfer indicators.
- Turn limits: Navigator Planning=50, Navigator Monitoring=50, Driver=20 (configurable via environment variables).

## Coding Style & Naming Conventions
- Language: TypeScript (strict). JSX in `.tsx` under `components/`.
- Modules: ES modules; use explicit file extensions in imports.
- Indentation: 2 spaces; single quotes; trailing commas allowed.
- Naming: PascalCase for components/classes; camelCase for functions/vars;
  UPPER_SNAKE_CASE for constants; hooks start with `use*`.
- Structure: prefer small, focused modules under `utils/`.
- Formatting/Linting: keep consistent with existing files; run `tsc` to type-check.

## Testing Guidelines
- Test runner: Vitest configured for unit and integration tests
- Unit tests: `test/unit/` directory structure
- Integration tests: `test/integration/` directory (requires `RUN_INTEGRATION_TESTS=true`)
- Commands:
  - `npm run test:unit` - Run unit tests
  - `npm run test:integration` - Run integration tests
  - `npm run test:coverage` - Run with coverage report
- Structure tests under `test/unit/` matching `src/` structure
- Prefer pure functions in `utils/` for easy unit testing

## Commit & Pull Request Guidelines
- Commits: imperative present tense (e.g., "add code review"). Conventional Commits are welcome (`feat:`, `fix:`, etc.).
- PRs: include purpose, linked issues, runnable example command, and screenshots/GIFs of terminal UI when relevant.
- Keep changes focused; update docs when behavior or flags change.
- Do not commit secrets; this CLI uses Anthropic credentials. Avoid committing large logs—`Logger` writes to `pair-debug.log`.

## Security & Configuration Tips
- Configure environment via `src/config.ts` and documented env vars in `README.md`.
- Never hardcode API keys; use env vars and your local Claude/Anthropic setup.
- Treat `dist/` as disposable build output; rebuild after changes.
- Avoid pushing changes that remove tool fences or reorder the message flow; the Claude API requires immediate tool_result after tool_use.

## CLI Usage
- Command: `pair` (no longer requires `claude` subcommand)
- Basic usage: `pair -p "your prompt"`
- Path specification: `pair --dir /your/project -p "your prompt"`
- File input: `pair -f prompt.txt`
- Provider/model configuration:
  - `--navigator <provider>` and `--navigator-model <model>`
  - `--driver <provider>` and `--driver-model <model>`
- Available providers: `claude-code` (default), `opencode`
- OpenCode requires explicit model: `--navigator opencode --navigator-model openrouter/google/gemini-2.5-flash`
