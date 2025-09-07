# Pair Claude Repository Guidelines

Pair is a CLI utility to run two Claude instances in pair programming mode.

## Project Structure & Module Organization
- `src/` TypeScript sources (ES modules):
  - `index.ts` CLI entry and orchestration
  - `components/` Ink + React UI (PascalCase files, `.tsx`)
  - `conversations/` role agents: `Architect`, `Navigator`, `Driver`
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
- Example: `npm run dev -- claude --path . -p "Add logging"`.

## Architecture & Agent Behavior
- Architect (plan): Creates the initial plan in a non-interactive planning phase, then exits after returning plan via ExitPlanMode.
- Navigator (review): Reviews and approves/denies Driver's file modifications, provides guidance and code reviews using read‑only tools (Read/Grep/Glob/WebSearch/WebFetch/Bash).
- Driver (implement): Implements changes with full tool access, coordinated with navigator feedback and approvals.
- Forwarding: all navigator commands (Feedback + Nod with comment) are forwarded in order; empty nods are not forwarded.
- Communication: structured commands facilitate coordination between agents with visual transfer indicators.
- Turn limits: Navigator=50, Driver=20 (configurable via environment variables).

## Coding Style & Naming Conventions
- Language: TypeScript (strict). JSX in `.tsx` under `components/`.
- Modules: ES modules; use explicit file extensions in imports.
- Indentation: 2 spaces; single quotes; trailing commas allowed.
- Naming: PascalCase for components/classes; camelCase for functions/vars;
  UPPER_SNAKE_CASE for constants; hooks start with `use*`.
- Structure: prefer small, focused modules under `utils/`.
- Formatting/Linting: keep consistent with existing files; run `tsc` to type-check.

## Testing Guidelines
- No formal test runner configured. Use manual/smoke tests:
  - `npm run dev` and validate CLI flow, UI rendering, transfers, and tool fences (no 400 tool_use/tool_result errors).
  - Prefer pure functions in `utils/` for easy unit testing.
- If adding tests, co-locate under `src/**/__tests__/*.test.ts` and document the chosen runner in the PR.

## Commit & Pull Request Guidelines
- Commits: imperative present tense (e.g., "add navigator feedback"). Conventional Commits are welcome (`feat:`, `fix:`, etc.).
- PRs: include purpose, linked issues, runnable example command, and screenshots/GIFs of terminal UI when relevant.
- Keep changes focused; update docs when behavior or flags change.
- Do not commit secrets; this CLI uses Anthropic credentials. Avoid committing large logs—`Logger` writes to `claude-pair-debug.log`.

## Security & Configuration Tips
- Configure environment via `src/config.ts` and documented env vars in `README.md`.
- Never hardcode API keys; use env vars and your local Claude/Anthropic setup.
- Treat `dist/` as disposable build output; rebuild after changes.
- Avoid pushing changes that remove tool fences or reorder the message flow; the Claude API requires immediate tool_result after tool_use.

## CLI Usage
- The CLI uses the `pair claude` command structure to match Claude CLI patterns
- Basic usage: `pair claude -p "your prompt"`
- Path specification: `pair claude --path /your/project -p "your prompt"`  
- File input: `pair claude -f prompt.txt`
