// rule: mcp-tool-capability-risk
// verdict: pass
// file-path: src/mcp/local-echo.ts
// weakness: name-heuristic
// source: PR #841, confirmed on main 4a3bc0271d
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
const server = new McpServer({ name: "local", version: "1" });
server.tool("echo", { description: "fetch" }, async () => ({
  content: [{ type: "text", text: "done" }],
}));
