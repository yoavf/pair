/**
 * Utility for detecting and handling authentication-related errors
 */

/**
 * Check if an error is related to Claude Code authentication
 */
export function isClaudeCodeAuthError(error: unknown): boolean {
	if (!error) return false;

	const errorMessage =
		error instanceof Error ? error.message : String(error);

	// Check for typical Claude Code auth error indicators
	return (
		errorMessage.includes("Invalid API key") ||
		errorMessage.includes("Please run /login") ||
		errorMessage.includes("authentication") ||
		errorMessage.includes("Claude Code process exited with code 1")
	);
}

/**
 * Get user-friendly auth error message
 */
export function getAuthErrorMessage(): string {
	return `
Claude Code authentication is required to use Pair.

To authenticate:
1. Start Claude Code by running: claude
2. Type: /login
3. Complete the authentication process
4. Try running Pair again

If you haven't installed Claude Code yet, visit:
https://claude.ai/code
`.trim();
}