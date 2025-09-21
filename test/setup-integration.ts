/**
 * Setup for integration tests
 * Starts MCP server for tests that need it
 */

import { startPairMcpServer, type PairMcpServer } from "../src/mcp/httpServer.js";

let mcpServer: PairMcpServer | null = null;

export async function setupMcpServer(): Promise<PairMcpServer> {
  if (!mcpServer) {
    mcpServer = await startPairMcpServer();
  }
  return mcpServer;
}

export async function teardownMcpServer(): Promise<void> {
  if (mcpServer) {
    await mcpServer.close();
    mcpServer = null;
  }
}