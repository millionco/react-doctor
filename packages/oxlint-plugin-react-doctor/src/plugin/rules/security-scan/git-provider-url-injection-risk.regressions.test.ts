import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { gitProviderUrlInjectionRisk } from "./git-provider-url-injection-risk.js";

describe("security-scan/git-provider-url-injection-risk — regressions", () => {
  it("stays silent on commit links built from internal constants (excalidraw/cal.com shape)", () => {
    const findings = runScanRule(gitProviderUrlInjectionRisk, {
      relativePath: "src/components/credits.tsx",
      content: `const commitUrl = \`https://github.com/calcom/cal.com/commit/\${COMMIT_SHA}\`;\nconst issueUrl = \`https://github.com/excalidraw/excalidraw/issues/new?body=\${encodeURIComponent(errorStack)}\`;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("flags provider URLs interpolating request-sourced values", () => {
    const findings = runScanRule(gitProviderUrlInjectionRisk, {
      relativePath: "src/server/repos.ts",
      content: `const apiUrl = \`https://api.github.com/repos/\${req.query.owner}/\${req.query.repo}\`;\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on bare owner/repo parameters without a request source", () => {
    const findings = runScanRule(gitProviderUrlInjectionRisk, {
      relativePath: "src/repo-browser/github-client.ts",
      content:
        "const branchResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches/${branch}`);\n",
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on config-sourced app slugs in provider URLs", () => {
    const findings = runScanRule(gitProviderUrlInjectionRisk, {
      relativePath: "src/github-app-connect.ts",
      content: "const baseUrl = `https://github.com/apps/${this.config.slug}/installations/new`;\n",
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent in test-data directories (conductor diagramTests shape)", () => {
    const findings = runScanRule(gitProviderUrlInjectionRisk, {
      relativePath: "src/testData/diagramTests.js",
      content:
        'const task = { uri: "https://api.github.com/repos/${workflow.input.gh_account}/${workflow.input.gh_repo}" };\n',
    });
    expect(findings).toHaveLength(0);
  });
});
