import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { agentToolCapabilityRisk } from "./agent-tool-capability-risk.js";

describe("security-scan/agent-tool-capability-risk — regressions", () => {
  it("stays silent when capability words appear only in the description and execute handler key", () => {
    const content = [
      'import { tool } from "ai";',
      "export const listItems = tool({",
      '  description: "List items. ALWAYS fetch the underlying numbers first.",',
      "  inputSchema: z.object({ organizationId: z.string() }),",
      "  execute: async ({ organizationId }) => {",
      '    if (organizationId !== allowedOrgId) return { error: "Access denied" };',
      "    return prisma.item.findMany({ where: { organizationId } });",
      "  },",
      "});",
    ].join("\n");
    const findings = runScanRule(agentToolCapabilityRisk, {
      relativePath: "src/lib/tools/campaign-stats.ts",
      content,
    });
    expect(findings).toHaveLength(0);
  });

  it("flags a tool handler that actually shells out", () => {
    const content = [
      'import { tool } from "ai";',
      "export const runShell = tool({",
      '  description: "Run a command",',
      "  inputSchema: z.object({ cmd: z.string() }),",
      "  execute: async ({ cmd }) => {",
      "    return exec(cmd);",
      "  },",
      "});",
    ].join("\n");
    const findings = runScanRule(agentToolCapabilityRisk, {
      relativePath: "src/lib/tools/run-shell.ts",
      content,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags a tool handler that actually calls fetch in code", () => {
    const content = [
      'import { tool } from "ai";',
      "export const getData = tool({",
      '  description: "Get data",',
      "  execute: async ({ url }) => fetch(url),",
      "});",
    ].join("\n");
    const findings = runScanRule(agentToolCapabilityRisk, {
      relativePath: "src/lib/tools/get-data.ts",
      content,
    });
    expect(findings).toHaveLength(1);
  });
});
