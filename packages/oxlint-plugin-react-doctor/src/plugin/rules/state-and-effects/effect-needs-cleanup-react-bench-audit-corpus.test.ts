import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

interface ReactBenchAuditCallsite {
  auditVersion: string;
  filePath: string;
  fixture: string;
  reportedLine: number;
  rule: string;
  suffix: string;
  verdict: "fail" | "pass";
}

interface ReactBenchAuditManifest {
  callsites: ReactBenchAuditCallsite[];
}

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const corpusDirectory = path.resolve(testDirectory, "../../../../../fuzz/corpus");
const manifestPath = path.join(corpusDirectory, "react-bench-0.9.7-audit.json");
const fixtureHeaderPattern = /^(?:\/\/[^\n]*\n){5}/;

describe("React Bench exact effect cleanup audit corpus", () => {
  it("keeps every audited 0.9.9 false-positive callsite clean", () => {
    const manifest: ReactBenchAuditManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const callsites = manifest.callsites.filter(
      (callsite) =>
        callsite.auditVersion === "0.9.9" &&
        callsite.rule === "effect-needs-cleanup" &&
        callsite.verdict === "pass",
    );

    expect(callsites).toHaveLength(225);
    for (const callsite of callsites) {
      const fixturePath = path.join(corpusDirectory, callsite.fixture);
      const source = fs.readFileSync(fixturePath, "utf8").replace(fixtureHeaderPattern, "");
      const result = runRule(effectNeedsCleanup, source, {
        filename: path.join(path.dirname(fixturePath), callsite.filePath),
        includeLocations: true,
      });
      const hasTargetDiagnostic = result.diagnostics.some(
        (diagnostic) => diagnostic.line === callsite.reportedLine,
      );

      expect(hasTargetDiagnostic, `${callsite.suffix}:${callsite.filePath}`).toBe(false);
    }
  });
});
