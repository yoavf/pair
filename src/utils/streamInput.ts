// biome-ignore lint/suspicious/noExplicitAny: Stream bridges SDK messages with mixed shapes
export class AsyncUserMessageStream implements AsyncIterable<any> {
	// biome-ignore lint/suspicious/noExplicitAny: message/event shapes vary across SDK versions
	private queue: any[] = [];
	// biome-ignore lint/suspicious/noExplicitAny: iterator result type depends on SDK transport
	private resolvers: Array<(value: IteratorResult<any>) => void> = [];
	private done = false;

	pushText(text: string) {
		if (this.done) return;
		// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK user message structure
		const userMessage: any = {
			type: "user",
			userType: "external",
			message: {
				role: "user",
				// Use standard 'text' items; 'input_text' is not supported by this SDK/API
				content: [{ type: "text", text }],
			},
			parent_tool_use_id: null,
		};
		this.enqueue(userMessage);
	}

	end() {
		this.done = true;
		while (this.resolvers.length) {
			const resolve = this.resolvers.shift();
			if (resolve) {
				resolve({ value: undefined, done: true });
			}
		}
	}

	// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK user message structure
	private enqueue(item: any) {
		if (this.resolvers.length) {
			const resolve = this.resolvers.shift();
			if (resolve) {
				resolve({ value: item, done: false });
			}
		} else {
			this.queue.push(item);
		}
	}

	// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK user message interface
	[Symbol.asyncIterator](): AsyncIterator<any> {
		return {
			next: () => {
				if (this.queue.length) {
					const value = this.queue.shift();
					if (value) {
						return Promise.resolve({
							value,
							done: false,
						});
					}
				}
				if (this.done) {
					return Promise.resolve({ value: undefined, done: true });
				}
				// biome-ignore lint/suspicious/noExplicitAny: Claude Code SDK iterator interface
				return new Promise<IteratorResult<any>>((resolve) => {
					this.resolvers.push(resolve);
				});
			},
		};
	}
}
