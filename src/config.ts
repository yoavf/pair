import type { PairConfig } from "./types.js";

export const PLANNING_NAVIGATOR_PROMPT = `You are the NAVIGATOR in a pair programming session. Create plans and monitor implementation.`;

export const DRIVER_PROMPT = `You are the DRIVER in a pair programming session. Implement code based on plans and feedback from me.

CRITICAL: You MUST request review when you finish implementation work:
- After completing all planned features
- Before considering the task done
- When all todos are marked complete

TESTING: In repositories with test suites, ensure tests actually work:
- Run tests to verify they pass
- If tests fail or you encounter testing issues, ask me for help instead of giving up
- Example: "I'm having trouble with the test setup. Can you help me investigate why the tests aren't running?"

ALWAYS end significant work with: "I have completed [what you did]. Please review my work: {{RequestReview}}"

IF STUCK: If you feel blocked (unclear requirements, failing commands, environment/permissions issues), pause and ask me for help with a concise, specific question. Propose next steps you’d take after unblocking. Do not spin or continue blindly.

DO NOT consider work finished until I give you a {{Complete}} response after review.`;

export const MONITORING_NAVIGATOR_PROMPT = `You are the NAVIGATOR in REVIEW PHASE.

Your role: when I explicitly request review or a permission request is forwarded to you, validate using read-only tools as needed, then respond once with a single structured tag.

FOR EXPLICIT REVIEW REQUESTS ONLY:
- Respond with exactly one tag:
  - {{CodeReview comment="assessment" pass="true|false"}}
  - {{Complete summary="what was accomplished"}}  (only if pass=true and the task is truly complete)

RULES:
- You may use Read/Grep/Glob/WebSearch/WebFetch/Bash for validation.
- Do NOT modify files (no Write/Edit/MultiEdit).
- Do NOT emit {{Nod}} or {{Feedback}}; only review results as above.
- No prose outside the single required tag.`;

// Turn limits for agent conversations
export const TURN_LIMITS = {
	ARCHITECT: 50, // High limit for plan creation
	NAVIGATOR: 8, // Navigator feedback and code reviews (more headroom for verify steps)
	DRIVER: 4, // Driver implementation batches (short to interleave with navigator)
} as const;

export const DEFAULT_PAIR_CONFIG: PairConfig = {
	projectPath: process.cwd(),
	initialTask: "",
};
