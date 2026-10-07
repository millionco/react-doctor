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

  it("uses the security scan's partial deadline explanation", () => {
    const securityScanFailureReason =
      "Security scan reached the max scan duration; findings collected before the deadline were preserved.";
    const result = buildSkippedChecks({
      didLintFail: false,
      lintFailureReason: null,
      lintPartialFailures: [],
      didDeadCodeFail: false,
      deadCodeFailureReason: null,
      securityScanFailed: true,
      securityScanFailureReason,
    });

    expect(result.skippedCheckReasons["security-scan"]).toBe(securityScanFailureReason);
  });

  it("preserves the dead-code compatibility key for maintainability failures", () => {
    const failureReason = "Maintainability analysis was incomplete.";
    const result = buildSkippedChecks({
      didLintFail: false,
      lintFailureReason: null,
      lintPartialFailures: [],
      didDeadCodeFail: true,
      deadCodeFailureReason: failureReason,
      supplyChainOverlapTimedOut: false,
      securityScanFailed: false,
    });

    expect(result.skippedChecks).toEqual(["dead-code"]);
    expect(result.skippedCheckReasons["dead-code"]).toBe(failureReason);
  });
});
