import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { agentToolCapabilityRisk } from "./agent-tool-capability-risk.js";

describe("security-scan/agent-tool-capability-risk — regressions", () => {
  it("stays silent when a capability keyword appears only in description prose (#838)", () => {
    const findings = runScanRule(agentToolCapabilityRisk, {
      relativePath: "src/agents/tools/list-items.ts",
      content: `import { tool } from "ai";
export const listItems = tool({
  description: "List items. ALWAYS fetch the underlying numbers first.",
  inputSchema: z.object({ organizationId: z.string() }),
  execute: async ({ organizationId }) => {
    if (organizationId !== allowedOrgId) return { error: "Access denied" };
    return prisma.item.findMany({ where: { organizationId } });
  },
});
`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags a tool whose handler wires a real shell/network primitive", () => {
    const findings = runScanRule(agentToolCapabilityRisk, {
      relativePath: "src/agents/tools/run-command.ts",
      content: `import { tool } from "ai";
import { exec } from "node:child_process";
export const runCommand = tool({
  description: "Run a shell command on the host.",
  inputSchema: z.object({ command: z.string() }),
  execute: async ({ command }) => exec(command),
});
`,
    });
    expect(findings).toHaveLength(1);
  });

  it("still flags a tool that imports a dangerous module by specifier", () => {
    const findings = runScanRule(agentToolCapabilityRisk, {
      relativePath: "src/agents/tools/run-command-tool.ts",
      content: `import { tool } from "ai";
import { execFile } from "node:child_process";
export const runCommandTool = tool({
  description: "Run a repository maintenance command",
  execute: async ({ command }: { readonly command: string }) => {
    execFile(command, []);
    return { ok: true };
  },
});
`,
    });
    expect(findings).toHaveLength(1);
  });

  it("still flags a tool handler that calls fetch on attacker-controlled input", () => {
    const findings = runScanRule(agentToolCapabilityRisk, {
      relativePath: "src/agents/tools/proxy.ts",
      content: `import { tool } from "ai";
export const proxy = tool({
  description: "Proxy a request to any URL.",
  inputSchema: z.object({ url: z.string() }),
  execute: async ({ url }) => fetch(url).then((response) => response.text()),
});
`,
    });
    expect(findings).toHaveLength(1);
  });

  it("still flags a capability call that only appears in a template interpolation", () => {
    const findings = runScanRule(agentToolCapabilityRisk, {
      relativePath: "src/agents/tools/proxy.ts",
      content: `import { tool } from "ai";
export const proxy = tool({
  description: "Summarize a URL.",
  inputSchema: z.object({ url: z.string() }),
  execute: async ({ url }) => \`page: \${await fetch(url).then((response) => response.text())}\`,
});
`,
    });
    expect(findings).toHaveLength(1);
  });
});
