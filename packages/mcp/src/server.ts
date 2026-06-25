import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MCP_SERVER_NAME } from "./constants.js";
import { registerBrowserTools } from "./tools/browser.js";
import { registerDebugTools } from "./tools/debug.js";
import { registerDoctorTools } from "./tools/doctor.js";

export interface StartMcpServerOptions {
  version: string;
}

// Build the server with every tool registered, but without a transport — so
// tests can introspect it and the entry point owns the stdio wiring.
export const createMcpServer = (options: StartMcpServerOptions): McpServer => {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: options.version });
  registerDoctorTools(server);
  registerBrowserTools(server);
  registerDebugTools(server);
  return server;
};

// Run the server over stdio. The transport owns stdout for the JSON-RPC stream,
// so nothing on this path may write to stdout (tool handlers return content;
// diagnostics go to stderr).
export const startMcpServer = async (options: StartMcpServerOptions): Promise<void> => {
  const server = createMcpServer(options);
  await server.connect(new StdioServerTransport());
};
