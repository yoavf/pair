import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { parse as parseUrl } from "node:url";
import { createSdkMcpServer } from "@anthropic-ai/claude-code";
import {
	driverRequestGuidance,
	driverRequestReview,
	navigatorApprove,
	navigatorCodeReview,
	navigatorComplete,
	navigatorDeny,
} from "../utils/mcpTools.js";

type TransportMap = Map<string, any>;

export interface PairMcpServer {
	port: number;
	urls: { navigator: string; driver: string };
	close: () => Promise<void>;
}

/**
 * Start a single HTTP process that serves two MCP servers over SSE:
 * - /mcp/navigator for navigator tools
 * - /mcp/driver for driver tools
 */
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Logger } from "../utils/logger.js";

export async function startPairMcpServer(
	port?: number,
	logger?: Logger,
): Promise<PairMcpServer> {
	// Create MCP servers using Claude Code helper (reuses our zod tool schemas/handlers)
	const navigatorServer = createSdkMcpServer({
		name: "navigator",
		version: "1.0.0",
		tools: [
			navigatorCodeReview,
			navigatorComplete,
			navigatorApprove,
			navigatorDeny,
		],
	}).instance;

	const driverServer = createSdkMcpServer({
		name: "driver",
		version: "1.0.0",
		tools: [driverRequestReview, driverRequestGuidance],
	}).instance;

	// Log server/tool setup for diagnostics
	try {
		logger?.logEvent("MCP_HTTP_SERVER_INIT", {
			port: port ?? 0,
			navigatorTools: [
				"mcp__navigator__navigatorCodeReview",
				"mcp__navigator__navigatorComplete",
				"mcp__navigator__navigatorApprove",
				"mcp__navigator__navigatorDeny",
			],
			driverTools: [
				"mcp__driver__driverRequestReview",
				"mcp__driver__driverRequestGuidance",
			],
		});
	} catch {}

	const navTransports: TransportMap = new Map();
	const drvTransports: TransportMap = new Map();

	const server = http.createServer(
		async (req: IncomingMessage, res: ServerResponse) => {
			try {
				const urlObj = parseUrl(req.url || "", true);
				const pathname = urlObj.pathname || "";
				if (req.method === "GET" && pathname === "/healthz") {
					res.writeHead(200).end("ok");
					return;
				}

				// Navigator SSE handshake
				if (req.method === "GET" && pathname === "/mcp/navigator") {
					const transport = new SSEServerTransport(
						"/mcp/navigator/message",
						res,
					);
					try {
						// connect() starts the transport; do not call start() again
						await navigatorServer.connect(transport);
						if (!transport.sessionId) {
							logger?.logEvent("MCP_SSE_CONNECT_ERROR", {
								role: "navigator",
								error: "Missing sessionId after connect",
							});
							res.writeHead(500, { "Content-Type": "application/json" }).end(
								JSON.stringify({
									error:
										"Failed to establish MCP connection: missing sessionId",
								}),
							);
							return;
						}
						navTransports.set(transport.sessionId, transport);
						try {
							logger?.logEvent("MCP_SSE_CONNECTED", {
								role: "navigator",
								sessionId: transport.sessionId,
							});
						} catch {}
						// Clean up when SSE closes
						transport.onclose = () => {
							navTransports.delete(transport.sessionId);
							try {
								logger?.logEvent("MCP_SSE_CLOSED", {
									role: "navigator",
									sessionId: transport.sessionId,
								});
							} catch {}
						};
						return; // leave connection open
					} catch (err) {
						logger?.logEvent("MCP_SSE_CONNECT_ERROR", {
							role: "navigator",
							error: err instanceof Error ? err.message : String(err),
						});
						res
							.writeHead(500, { "Content-Type": "application/json" })
							.end(
								JSON.stringify({ error: "Failed to establish MCP connection" }),
							);
						return;
					}
				}
				// Navigator POST message endpoint
				if (req.method === "POST" && pathname === "/mcp/navigator/message") {
					const sid = urlObj.query.sessionId as string | undefined;
					const t = sid ? navTransports.get(sid) : undefined;
					if (!t) {
						try {
							logger?.logEvent("MCP_SSE_POST_SESSION_MISSING", {
								role: "navigator",
								sid,
								knownSessions: Array.from(navTransports.keys()),
							});
						} catch {}
						res.writeHead(404).end("session not found");
						return;
					}
					try {
						logger?.logEvent("MCP_SSE_POST", {
							role: "navigator",
							sessionId: sid,
						});
					} catch {}
					await t.handlePostMessage(req, res);
					return;
				}

				// Driver SSE handshake
				if (req.method === "GET" && pathname === "/mcp/driver") {
					const transport = new SSEServerTransport("/mcp/driver/message", res);
					try {
						// connect() starts the transport; do not call start() again
						await driverServer.connect(transport);
						if (!transport.sessionId) {
							logger?.logEvent("MCP_SSE_CONNECT_ERROR", {
								role: "driver",
								error: "Missing sessionId after connect",
							});
							res.writeHead(500, { "Content-Type": "application/json" }).end(
								JSON.stringify({
									error:
										"Failed to establish MCP connection: missing sessionId",
								}),
							);
							return;
						}
						drvTransports.set(transport.sessionId, transport);
						try {
							logger?.logEvent("MCP_SSE_CONNECTED", {
								role: "driver",
								sessionId: transport.sessionId,
							});
						} catch {}
						transport.onclose = () => {
							drvTransports.delete(transport.sessionId);
							try {
								logger?.logEvent("MCP_SSE_CLOSED", {
									role: "driver",
									sessionId: transport.sessionId,
								});
							} catch {}
						};
						return;
					} catch (err) {
						logger?.logEvent("MCP_SSE_CONNECT_ERROR", {
							role: "driver",
							error: err instanceof Error ? err.message : String(err),
						});
						res
							.writeHead(500, { "Content-Type": "application/json" })
							.end(
								JSON.stringify({ error: "Failed to establish MCP connection" }),
							);
						return;
					}
				}
				// Driver POST message endpoint
				if (req.method === "POST" && pathname === "/mcp/driver/message") {
					const sid = urlObj.query.sessionId as string | undefined;
					const t = sid ? drvTransports.get(sid) : undefined;
					if (!t) {
						try {
							logger?.logEvent("MCP_SSE_POST_SESSION_MISSING", {
								role: "driver",
								sid,
								knownSessions: Array.from(drvTransports.keys()),
							});
						} catch {}
						res.writeHead(404).end("session not found");
						return;
					}
					try {
						logger?.logEvent("MCP_SSE_POST", {
							role: "driver",
							sessionId: sid,
						});
					} catch {}
					await t.handlePostMessage(req, res);
					return;
				}

				res.writeHead(404).end("not found");
			} catch (err) {
				try {
					res.writeHead(500).end("error");
				} catch {}
				try {
					logger?.logEvent("MCP_HTTP_SERVER_ERROR", {
						error: err instanceof Error ? err.message : String(err),
					});
				} catch {}
			}
		},
	);

	await new Promise<void>((resolve) => {
		server.listen(port ?? 0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	const boundPort =
		typeof address === "object" && address && "port" in address
			? ((address as any).port as number)
			: (port ?? 0);

	try {
		logger?.logEvent("MCP_HTTP_SERVER_LISTENING", {
			port: boundPort,
			urls: {
				navigator: `http://127.0.0.1:${boundPort}/mcp/navigator`,
				driver: `http://127.0.0.1:${boundPort}/mcp/driver`,
			},
		});
	} catch {}

	return {
		port: boundPort,
		urls: {
			navigator: `http://127.0.0.1:${boundPort}/mcp/navigator`,
			driver: `http://127.0.0.1:${boundPort}/mcp/driver`,
		},
		close: async () => {
			// Force close all existing connections before closing server
			for (const [, transport] of navTransports) {
				try {
					if (transport.close) {
						transport.close();
					}
				} catch (_e) {
					// Ignore close errors
				}
			}
			navTransports.clear();

			for (const [, transport] of drvTransports) {
				try {
					if (transport.close) {
						transport.close();
					}
				} catch (_e) {
					// Ignore close errors
				}
			}
			drvTransports.clear();

			await new Promise<void>((resolve) => {
				server.close(() => resolve());
			});
			try {
				logger?.logEvent("MCP_HTTP_SERVER_CLOSED", { port: boundPort });
			} catch {}
		},
	};
}
