import type { BlockingLevel, InspectResult, ReactDoctorConfig } from "@react-doctor/core";
import { describe, expect, it } from "vite-plus/test";
import { resolveScanExitCode } from "../src/cli/utils/resolve-scan-exit-code.js";
import type { SurfaceFilterableScan } from "../src/cli/utils/filter-scans-for-surface.js";
import { buildDiagnostic, buildTestProject } from "./regressions/_helpers.js";

interface BlockingExitCase {
  blockingLevel: BlockingLevel;
  expectedExitCode: number;
}

const buildScan = (
  overrides: Partial<InspectResult> = {},
  config: ReactDoctorConfig | null = null,
): SurfaceFilterableScan => ({
  result: {
    diagnostics: [],
    score: null,
    skippedChecks: [],
    project: buildTestProject({ rootDirectory: "/project" }),
    elapsedMilliseconds: 1,
    ...overrides,
  },
  config,
});

const warningScan = buildScan({ diagnostics: [buildDiagnostic({ severity: "warning" })] });
const errorScan = buildScan({ diagnostics: [buildDiagnostic({ severity: "error" })] });
const failedScan = buildScan({
  skippedChecks: ["lint"],
  skippedCheckReasons: { lint: "Oxlint failed." },
});
const blockingLevels: BlockingLevel[] = ["error", "warning", "none"];

describe("resolveScanExitCode", () => {
  it.each(blockingLevels)("preserves the %s gate without the option", (blockingLevel) => {
    expect(resolveScanExitCode({ scans: [warningScan], blockingLevel })).toBe(
      blockingLevel === "warning" ? 1 : 0,
    );
  });

  it.each([[], [buildScan()]])("returns success for clean or empty scans %j", (...scans) => {
    expect(resolveScanExitCode({ scans, blockingLevel: "error", warningExitCode: 123 })).toBe(0);
  });

  it("signals non-blocking warnings", () => {
    expect(
      resolveScanExitCode({ scans: [warningScan], blockingLevel: "error", warningExitCode: 123 }),
    ).toBe(123);
  });

  it.each<BlockingExitCase>([
    { blockingLevel: "error", expectedExitCode: 123 },
    { blockingLevel: "warning", expectedExitCode: 1 },
    { blockingLevel: "none", expectedExitCode: 0 },
  ])("preserves the $blockingLevel gate with the option", ({ blockingLevel, expectedExitCode }) => {
    expect(resolveScanExitCode({ scans: [warningScan], blockingLevel, warningExitCode: 123 })).toBe(
      expectedExitCode,
    );
  });

  it.each([
    [warningScan, errorScan],
    [errorScan, warningScan],
    [warningScan, failedScan],
    [failedScan, warningScan],
  ])("gives blocking failures priority across workspace projects", (...scans) => {
    expect(resolveScanExitCode({ scans, blockingLevel: "error", warningExitCode: 123 })).toBe(1);
  });

  it("keeps degraded baselines and score-only diagnostics exempt", () => {
    expect(
      resolveScanExitCode({
        scans: [warningScan, errorScan],
        blockingLevel: "error",
        warningExitCode: 123,
        diagnosticsAreGateExempt: true,
      }),
    ).toBe(0);
    expect(
      resolveScanExitCode({
        scans: [warningScan, failedScan],
        blockingLevel: "error",
        warningExitCode: 123,
        diagnosticsAreGateExempt: true,
      }),
    ).toBe(1);
  });

  it("uses each project's CI surface config", () => {
    const excludedWarningScan = buildScan(warningScan.result, {
      surfaces: { ciFailure: { excludeRules: ["react-doctor/test-rule"] } },
    });
    expect(
      resolveScanExitCode({
        scans: [excludedWarningScan],
        blockingLevel: "error",
        warningExitCode: 123,
      }),
    ).toBe(0);
    expect(
      resolveScanExitCode({
        scans: [excludedWarningScan, warningScan],
        blockingLevel: "error",
        warningExitCode: 123,
      }),
    ).toBe(123);
  });
});
