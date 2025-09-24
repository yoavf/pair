/**
 * OpenCode session implementations
 */

import type {
	AgentInputStream,
	AgentSession,
	StreamingAgentSession,
} from "../../types.js";
import { OpencodeSessionBase } from "./sessionBase.js";
import type { OpenCodeClient, StreamingSessionConfig } from "./types.js";

export class OpencodeArchitectSession
	extends OpencodeSessionBase
	implements AgentSession
{
	sendMessage(message: string): void {
		void this.enqueuePrompt(message);
	}

	async end(): Promise<void> {
		await super.end();
	}
}

export class OpencodeStreamingSession
	extends OpencodeSessionBase
	implements StreamingAgentSession
{
	readonly inputStream: AgentInputStream;

	constructor(
		clientFactory: () => Promise<OpenCodeClient>,
		streamingConfig: StreamingSessionConfig,
		disposeResources?: () => Promise<void> | void,
	) {
		super(clientFactory, streamingConfig, disposeResources);
		this.inputStream = {
			pushText: (text: string) => {
				void this.enqueuePrompt(text);
			},
			end: () => {
				void this.end();
			},
		};
	}

	async interrupt(): Promise<void> {
		await super.interrupt();
	}

	async end(): Promise<void> {
		await super.end();
	}
}
