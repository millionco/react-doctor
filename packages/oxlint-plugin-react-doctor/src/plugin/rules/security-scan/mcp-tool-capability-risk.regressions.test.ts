import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { mcpToolCapabilityRisk } from "./mcp-tool-capability-risk.js";

describe("security-scan/mcp-tool-capability-risk — regressions", () => {
  it("stays silent on McpServer construction and prompt registration (millionco/expect shape)", () => {
    const content = [
      'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";',
      'const server = new McpServer({ name: "expect", version: "0.0.1" });',
      'server.registerPrompt("rules", { description: "List rules" }, () => ({ messages: [] }));',
      "const catalog = await fetch(rulesUrl);",
    ].join("\n");
    const findings = runScanRule(mcpToolCapabilityRisk, {
      relativePath: "src/mcp/server.ts",
      content,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent when a capability keyword only appears in a tool description (#838 sibling)", () => {
    const content = [
      'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";',
      'const server = new McpServer({ name: "x", version: "1" });',
      'server.tool("list", { description: "Always fetch the latest data first" }, async () => ({',
      '  content: [{ type: "text", text: "ok" }],',
      "}));",
    ].join("\n");
    const findings = runScanRule(mcpToolCapabilityRisk, {
      relativePath: "src/mcp/list-tool.ts",
      content,
    });
    expect(findings).toHaveLength(0);
  });

  it("flags a tool handler that exposes shell execution", () => {
    const content = [
      'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";',
      'const server = new McpServer({ name: "x", version: "1" });',
      'server.tool("run", async ({ cmd }) => {',
      "  return execSync(cmd);",
      "});",
    ].join("\n");
    const findings = runScanRule(mcpToolCapabilityRisk, {
      relativePath: "src/mcp/tools.ts",
      content,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags a registerTool handler that reads the filesystem", () => {
    const content = [
      'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";',
      'server.registerTool("read", schema, async ({ path }) => {',
      "  return readFile(path, 'utf8');",
      "});",
    ].join("\n");
    const findings = runScanRule(mcpToolCapabilityRisk, {
      relativePath: "src/mcp/fs-tools.ts",
      content,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on a tool surface in a file with no dangerous capability", () => {
    const content = [
      'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";',
      'server.tool("ping", async () => ({ content: [{ type: "text", text: "pong" }] }));',
    ].join("\n");
    const findings = runScanRule(mcpToolCapabilityRisk, {
      relativePath: "src/mcp/ping.ts",
      content,
    });
    expect(findings).toHaveLength(0);
  });
});
