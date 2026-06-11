import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { pathTraversalRisk } from "./path-traversal-risk.js";

describe("security-scan/path-traversal-risk — regressions", () => {
  it("flags filesystem paths joined from request params", () => {
    const findings = runScanRule(pathTraversalRisk, {
      relativePath: "src/server/files.ts",
      content: `export const readUserFile = (req) => readFileSync(path.join(UPLOADS_DIR, req.params.fileName));\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent when a taint word only appears inside a string literal (posthog render-query shape)", () => {
    const findings = runScanRule(pathTraversalRisk, {
      relativePath: "frontend/bundler.mjs",
      content: `const outfile = path.resolve(__dirname, 'dist', 'render-query.js');\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent in build and tooling scripts", () => {
    const findings = runScanRule(pathTraversalRisk, {
      relativePath: "frontend/build.mjs",
      content: `const out = path.resolve(__dirname, parsed.outputDir);\n`,
    });
    expect(findings).toHaveLength(0);
  });
});
