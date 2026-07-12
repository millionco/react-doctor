import { describe, expect, it } from "vite-plus/test";
import { buildSkippedChecks } from "../src/build-skipped-checks.js";

describe("buildSkippedChecks", () => {
  it("preserves partial lint and failed auxiliary checks structurally", () => {
    const result = buildSkippedChecks({
      didLintFail: false,
      lintFailureReason: null,
      lintPartialFailures: ["React Hooks rules were skipped"],
      didDeadCodeFail: false,
      deadCodeFailureReason: null,
      supplyChainOverlapTimedOut: true,
      securityScanFailed: true,
    });

    expect(result.skippedChecks).toEqual(["supply-chain", "security-scan"]);
    expect(result.skippedCheckReasons).toEqual({
      "lint:partial": "React Hooks rules were skipped",
      "supply-chain": "Supply-chain analysis timed out and was skipped.",
      "security-scan": "Security scan failed and was skipped.",
    });
  });
});
