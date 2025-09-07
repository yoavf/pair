/**
 * Standalone demo: permission-gated tool usage coordinated by a Navigator.
 *
 * Goals of this demo:
 * - Model a Driver running with `permissionMode: "default"` (conceptually)
 * - Buffer Driver messages until a tool that requires permission is requested
 * - Bulk-send buffered Driver messages to a Navigator with the permission request
 * - Navigator returns a single approval decision and optional comment
 * - Driver proceeds only if approved
 *
 * Note: This demo intentionally avoids wiring the real Claude Code SDK network calls
 * so it can be run in environments without API access. It shows the intended orchestration
 * and where a real `canUseTool` callback would be placed in a production integration.
 */

type ToolName =
	| "Write"
	| "Edit"
	| "MultiEdit"
	| "Bash"
	| "Read"
	| "Grep"
	| "Glob"
	| "WebSearch"
	| "WebFetch";

type ToolInvocation = {
	name: ToolName;
	// The Claude Code SDK has structured inputs per tool; we keep this open for the demo.
	// biome-ignore lint/suspicious/noExplicitAny: demo structure for arbitrary tool inputs
	input: any;
};

type PermissionRequest = {
	tool: ToolInvocation;
	driverTranscript: string;
};

type PermissionDecision = {
	allow: boolean;
	// Optional: The approver may tighten or adjust the proposed input before granting permission
	// biome-ignore lint/suspicious/noExplicitAny: demo structure for arbitrary tool inputs
	updatedInput?: any;
	comment?: string;
};

/**
 * Collects Driver-visible text and tool summaries for bulk-forwarding to Navigator.
 */
class DriverTranscriptBuffer {
	private lines: string[] = [];

	appendText(text: string): void {
		const t = (text || "").trim();
		if (t) this.lines.push(t);
	}

	appendTool(tool: ToolInvocation): void {
		const file = tool.input?.file_path || tool.input?.path || "";
		const cmd = tool.input?.command || "";
		const toolLine =
			tool.name === "Bash" && cmd
				? `⚙️  Tool: Bash - ${String(cmd)}`
				: file
					? `⚙️  Tool: ${tool.name} - ${file}`
					: `⚙️  Tool: ${tool.name}`;
		this.lines.push(toolLine);
	}

	flush(): string {
		const joined = this.lines.join("\n");
		this.lines = [];
		return joined;
	}
}

/**
 * A Navigator-like approver that decides whether to allow tool usage.
 * In production this would call a Navigator session (read-only tools) and return a
 * single decision and optional comment. Here we provide a simple stub implementation.
 */
class NavigatorApprover {
	constructor(
		private mode: "auto-approve" | "manual-prompt" = "auto-approve",
	) {}

	async review(req: PermissionRequest): Promise<PermissionDecision> {
		// In a real integration: send `req.driverTranscript` + `req.tool` details to a
		// Navigator model with a single-output instruction (Approve/Deny + optional comment).
		if (this.mode === "manual-prompt") {
			// eslint-disable-next-line no-console
			console.log("\n===== PERMISSION REQUEST =====");
			// eslint-disable-next-line no-console
			console.log(req.driverTranscript);
			// eslint-disable-next-line no-console
			console.log("\nRequested tool:", req.tool.name, "input:", req.tool.input);
			// eslint-disable-next-line no-console
			const answer = await promptYesNo(
				"Navigator: approve this tool usage? [y/N] ",
			);
			return {
				allow: answer,
				updatedInput: req.tool.input,
				comment: answer ? "Approved" : "Denied",
			};
		}
		// Auto-approve by default for demo purposes
		return {
			allow: true,
			updatedInput: req.tool.input,
			comment: "Approved (auto)",
		};
	}
}

/**
 * Permission broker that implements the canUseTool-style handoff to Navigator.
 */
class PermissionBroker {
	constructor(
		private approver: NavigatorApprover,
		private buffer: DriverTranscriptBuffer,
	) {}

	/**
	 * Conceptual `canUseTool` hook to gate file-modifying tools.
	 */
	async canUseTool(tool: ToolInvocation): Promise<PermissionDecision> {
		const needsApproval =
			tool.name === "Write" ||
			tool.name === "Edit" ||
			tool.name === "MultiEdit";
		if (!needsApproval) return { allow: true, updatedInput: tool.input };

		// Bulk forward the Driver transcript along with the permission request
		const transcript = this.buffer.flush();
		const decision = await this.approver.review({
			tool,
			driverTranscript: transcript,
		});
		return decision;
	}
}

/**
 * Minimal driver simulation that produces text and requests to use tools.
 * In a real setup, these would be emitted by the Claude Code Driver session stream.
 */
async function simulateDriverFlow() {
	const buffer = new DriverTranscriptBuffer();
	const approver = new NavigatorApprover(
		process.env.MANUAL ? "manual-prompt" : "auto-approve",
	);
	const broker = new PermissionBroker(approver, buffer);

	// Driver emits some reasoning and a plan
	buffer.appendText("Planning: create a new utility file src/utils/perm.ts");
	buffer.appendText("I will scaffold the module and export a permit() helper.");

	// Driver wants to edit a file (permission-gated)
	const editInvocation: ToolInvocation = {
		name: "Edit",
		input: {
			file_path: "src/utils/perm.ts",
			// In a real tool call this would be a structured patch; we keep it simple here
			new_text: "export const permit = () => true;\n",
		},
	};
	buffer.appendTool(editInvocation);

	const decision = await broker.canUseTool(editInvocation);
	if (!decision.allow) {
		// eslint-disable-next-line no-console
		console.log("Navigator denied edit. Aborting.");
		return;
	}

	// Apply the approved input (could be updated by navigator)
	// eslint-disable-next-line no-console
	console.log(
		"Navigator approved. Proceeding with edit:",
		decision.updatedInput,
	);

	// Simulate continuing work without involving Navigator for read-only tools
	const readInvocation: ToolInvocation = {
		name: "Read",
		input: { file_path: "src/utils/perm.ts" },
	};
	buffer.appendTool(readInvocation);
	// No approval needed
	const readOk = await broker.canUseTool(readInvocation);
	// eslint-disable-next-line no-console
	console.log("Read allowed without approval:", readOk.allow);

	// Driver requests another modification
	const writeInvocation: ToolInvocation = {
		name: "Write",
		input: {
			file_path: "README.md",
			text: "\n\nAdded permissions demo section.\n",
		},
	};
	buffer.appendTool(writeInvocation);
	const decision2 = await broker.canUseTool(writeInvocation);
	// eslint-disable-next-line no-console
	console.log(
		"Second modification approved?",
		decision2.allow,
		"comment:",
		decision2.comment,
	);

	// End: show that the buffer is empty (everything was forwarded on approval boundaries)
	const remaining = buffer.flush();
	if (remaining) {
		// eslint-disable-next-line no-console
		console.log("\nRemaining buffered text (should be empty):");
		// eslint-disable-next-line no-console
		console.log(remaining);
	}
}

// Simple yes/no prompt utility
function promptYesNo(question: string): Promise<boolean> {
	return new Promise((resolve) => {
		process.stdout.write(question);
		process.stdin.setEncoding("utf8");
		const onData = (data: Buffer) => {
			const v = String(data).trim().toLowerCase();
			process.stdin.off("data", onData);
			resolve(v === "y" || v === "yes");
		};
		process.stdin.on("data", onData);
	});
}

// Entrypoint: run the simulation
simulateDriverFlow().catch((err) => {
	// eslint-disable-next-line no-console
	console.error("Demo failed:", err);
	process.exit(1);
});

/**
 * Where this integrates with the real Claude Code SDK
 * --------------------------------------------------
 *
 * - Start Driver session with options:
 *   - allowedTools: ['all'] (or a list)
 *   - permissionMode: 'default'
 *   - canUseTool: async ({ name, input }) => {
 *       const transcript = driverTranscriptBuffer.flush();
 *       const decision = await navigatorApprover.review({ tool: { name, input }, driverTranscript: transcript });
 *       return decision.allow
 *         ? { behavior: 'allow', updatedInput: decision.updatedInput ?? input }
 *         : { behavior: 'deny' };
 *     }
 * - Do not forward Navigator anything until canUseTool is called or a review is requested.
 * - When canUseTool triggers, bulk-forward buffered Driver messages in one payload together with the permission request.
 * - Navigator replies with a single decision + optional comment, which you can display and then continue Driver.
 */
