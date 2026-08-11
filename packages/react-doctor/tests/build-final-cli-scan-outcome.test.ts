import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic, InspectResult } from "@react-doctor/core";
import {
  buildFinalCliScanOutcome,
  type CompletedScan,
} from "../src/cli/utils/build-final-cli-scan-outcome.js";
import { buildDiagnostic, buildTestProject } from "./regressions/_helpers.js";

interface BuildCompletedScanOptions {
  readonly directory: string;
  readonly diagnostics?: Diagnostic[];
  readonly hasReact?: boolean;
  readonly baselineDelta?: InspectResult["baselineDelta"];
}

const buildCompletedScan = (options: BuildCompletedScanOptions): CompletedScan => ({
  directory: options.directory,
  config: null,
  result: {
    diagnostics: options.diagnostics ?? [],
    score: null,
    skippedChecks: [],
    project: buildTestProject({
      rootDirectory: options.directory,
      reactMajorVersion: options.hasReact === false ? null : 19,
      reactVersion: options.hasReact === false ? null : "^19.0.0",
    }),
    elapsedMilliseconds: 1,
    baselineDelta: options.baselineDelta,
  },
});

const buildOutcome = (
  completedScans: ReadonlyArray<CompletedScan>,
  overrides: Partial<Parameters<typeof buildFinalCliScanOutcome>[0]> = {},
) =>
  buildFinalCliScanOutcome({
    completedScans,
    skippedProjects: [],
    mode: "full",
    baselineIntended: false,
    categoryFilters: new Set(),
    ...overrides,
  });

describe("buildFinalCliScanOutcome", () => {
  it("aggregates a complete baseline across projects", () => {
    const outcome = buildOutcome(
      [
        buildCompletedScan({
          directory: "/repo/apps/web",
          baselineDelta: { baseRef: "abc123", fixedCount: 2, baseTotalCount: 5 },
        }),
        buildCompletedScan({
          directory: "/repo/apps/docs",
          baselineDelta: { baseRef: "abc123", fixedCount: 3, baseTotalCount: 7 },
        }),
      ],
      { mode: "baseline", baselineIntended: true },
    );

    expect(outcome.baselineDegraded).toBe(false);
    expect(outcome.mode).toBe("baseline");
    expect(outcome.baseline).toEqual({
      baseRef: "abc123",
      fixedCount: 5,
      baseTotalCount: 12,
    });
  });

  it("degrades an incomplete baseline to diff mode", () => {
    const outcome = buildOutcome(
      [
        buildCompletedScan({
          directory: "/repo/apps/web",
          baselineDelta: { baseRef: "abc123", fixedCount: 2, baseTotalCount: 5 },
        }),
        buildCompletedScan({ directory: "/repo/apps/docs" }),
      ],
      { mode: "baseline", baselineIntended: true },
    );

    expect(outcome.baselineDegraded).toBe(true);
    expect(outcome.mode).toBe("diff");
    expect(outcome.baseline).toBeUndefined();
  });

  it("detects completed scans where React rules were gated off", () => {
    expect(
      buildOutcome([buildCompletedScan({ directory: "/repo", hasReact: false })])
        .shouldWarnNoReactDetected,
    ).toBe(true);
    expect(
      buildOutcome([
        buildCompletedScan({ directory: "/repo/plain", hasReact: false }),
        buildCompletedScan({ directory: "/repo/react" }),
      ]).shouldWarnNoReactDetected,
    ).toBe(false);
    expect(buildOutcome([]).shouldWarnNoReactDetected).toBe(false);
  });

  it("filters only the JSON report diagnostics by category", () => {
    const correctnessDiagnostic = buildDiagnostic({ category: "Correctness" });
    const designDiagnostic = buildDiagnostic({ category: "Design" });
    const completedScan = buildCompletedScan({
      directory: "/repo",
      diagnostics: [correctnessDiagnostic, designDiagnostic],
    });

    const outcome = buildOutcome([completedScan], {
      categoryFilters: new Set(["Correctness"]),
    });

    expect(outcome.scansForJsonReport[0]?.result.diagnostics).toEqual([correctnessDiagnostic]);
    expect(completedScan.result.diagnostics).toEqual([correctnessDiagnostic, designDiagnostic]);
  });
});
