declare module "@modelcontextprotocol/sdk/dist/esm/server/sse.js" {
	export class SSEServerTransport {
		constructor(endpoint: string, res: any);
		start(): Promise<void>;
		handlePostMessage(req: any, res: any): Promise<void>;
		readonly sessionId: string;
		onclose?: () => void;
	}
}
