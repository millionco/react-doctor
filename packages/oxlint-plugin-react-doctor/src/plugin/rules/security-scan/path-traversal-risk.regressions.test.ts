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

  it("stays silent when request input is sanitized through path.basename()", () => {
    const findings = runScanRule(pathTraversalRisk, {
      relativePath: "src/server/files.ts",
      content: `const p = path.join(UPLOAD_DIR, path.basename(req.params.file));\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags request input joined without a sanitizer", () => {
    const findings = runScanRule(pathTraversalRisk, {
      relativePath: "src/server/files.ts",
      content: `const p = path.join(UPLOAD_DIR, req.params.file);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  // FP wave 4: a static literal path segment whose filename happens to be
  // spelled like a taint accessor (`public/body.html`, `${dir}/query.sql`)
  // is preceded by `/` or a backtick — never a real request read.
  it("stays silent on a static path segment after a slash", () => {
    const findings = runScanRule(pathTraversalRisk, {
      relativePath: "src/server/handler.ts",
      content: `fs.readFileSync(path.join(__dirname, "public/body.html"));\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on a template literal suffix after a slash", () => {
    const findings = runScanRule(pathTraversalRisk, {
      relativePath: "src/server/handler.ts",
      content: "readFile(`${dir}/query.sql`);\n",
    });
    expect(findings).toHaveLength(0);
  });
});
