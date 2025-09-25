/**
 * Async message queue utility for OpenCode event streaming
 */

export class AsyncMessageQueue<T> implements AsyncIterable<T> {
	private readonly queue: T[] = [];
	private readonly resolvers: Array<(value: IteratorResult<T, void>) => void> =
		[];
	private done = false;
	private error: unknown = null;

	push(value: T): void {
		if (this.done) return;
		if (this.resolvers.length > 0) {
			const resolve = this.resolvers.shift();
			resolve?.({ value, done: false });
		} else {
			this.queue.push(value);
		}
	}

	finish(): void {
		if (this.done) return;
		this.done = true;
		while (this.resolvers.length > 0) {
			const resolve = this.resolvers.shift();
			resolve?.({ value: undefined, done: true });
		}
	}

	throw(error: unknown): void {
		if (this.done) return;
		this.error = error;
		this.done = true;
		while (this.resolvers.length > 0) {
			const resolve = this.resolvers.shift();
			if (resolve) {
				resolve({
					value: undefined,
					done: true,
				});
			}
		}
	}

	private async next(): Promise<IteratorResult<T, void>> {
		if (this.error) {
			throw this.error;
		}

		if (this.queue.length > 0) {
			const value = this.queue.shift()!;
			return { value, done: false };
		}

		if (this.done) {
			return { value: undefined, done: true };
		}

		return new Promise<IteratorResult<T, void>>((resolve) => {
			this.resolvers.push(resolve);
		});
	}

	[Symbol.asyncIterator](): AsyncIterator<T, void, unknown> {
		return {
			next: () => this.next(),
		};
	}
}
