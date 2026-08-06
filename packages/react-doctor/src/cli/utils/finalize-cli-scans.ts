import { performance } from "node:perf_hooks";
import {
  buildJsonReport,
  type DiffInfo,
  hasReactRuntime,
  type InspectResult,
  type JsonReportMode,
  type JsonReportSkippedProject,
  type ReactDoctorConfig,
} from "@react-doctor/core";
import { cliLogger as logger } from "./cli-logger.js";
import { METRIC } from "./constants.js";
import { filterDiagnosticsByCategories } from "./filter-diagnostics-by-categories.js";
import { formatSkippedProjectsMessage } from "./format-skipped-projects-message.js";
import type { InspectFlags } from "./inspect-flags.js";
import { writeJsonReport } from "./json-mode.js";
import { recordCount } from "./record-metric.js";
import { resolveBlockingLevel } from "./resolve-blocking-level.js";
import { shouldFailScanGate } from "./should-fail-scan-gate.js";
import { VERSION } from "./version.js";

export interface CompletedScan {
  readonly directory: string;
  readonly result: InspectResult;
  readonly config: ReactDoctorConfig | null;
}

interface FinalizeCliScansInput {
  readonly completedScans: ReadonlyArray<CompletedScan>;
  readonly skippedProjects: ReadonlyArray<JsonReportSkippedProject>;
  readonly mode: JsonReportMode;
  readonly diff: DiffInfo | null;
  readonly baselineIntended: boolean;
  readonly isJsonMode: boolean;
  readonly isScoreOnly: boolean;
  readonly flags: InspectFlags;
  readonly categoryFilters: ReadonlySet<string>;
  readonly userConfig: ReactDoctorConfig | null;
  readonly resolvedDirectory: string;
  readonly startTime: number;
}

interface ReportSkippedProjectsInput {
  readonly skippedProjects: JsonReportSkippedProject[];
  readonly isQuiet: boolean;
}

const filterCompletedScansByCategories = (
  completedScans: ReadonlyArray<CompletedScan>,
  categoryFilters: ReadonlySet<string>,
): CompletedScan[] =>
  categoryFilters.size === 0
    ? [...completedScans]
    : completedScans.map((scan) => ({
        ...scan,
        result: {
          ...scan.result,
          diagnostics: filterDiagnosticsByCategories(scan.result.diagnostics, categoryFilters),
        },
      }));

export const reportSkippedProjects = (input: ReportSkippedProjectsInput): void => {
  input.skippedProjects.sort((left, right) => left.directory.localeCompare(right.directory));
  if (input.skippedProjects.length === 0) return;

  recordCount(METRIC.scanProjectSkipped, input.skippedProjects.length, {
    reason: "max-duration",
  });
  if (!input.isQuiet) {
    logger.warn(formatSkippedProjectsMessage(input.skippedProjects.length));
    logger.break();
  }
};

export const finalizeCliScans = (input: FinalizeCliScansInput): void => {
  const baselineDeltas = input.completedScans.flatMap((scan) =>
    scan.result.baselineDelta ? [scan.result.baselineDelta] : [],
  );
  const baselineComputed =
    input.skippedProjects.length === 0 &&
    input.completedScans.length > 0 &&
    input.completedScans.every((scan) => scan.result.baselineDelta !== undefined);
  const baselineDegraded = input.baselineIntended && !baselineComputed;
  const mode: JsonReportMode = baselineDegraded ? "diff" : input.mode;
  const isReactDetected = input.completedScans.some((scan) => hasReactRuntime(scan.result.project));

  if (input.completedScans.length > 0 && !isReactDetected) {
    recordCount(METRIC.scanNoReactDetected, 1);
    logger.warn(
      `No React project detected at ${input.resolvedDirectory} — React rules were gated off; this is not the same as a clean scan.`,
    );
  }

  if (input.isJsonMode) {
    const baseline =
      baselineComputed && baselineDeltas.length > 0
        ? {
            baseRef: baselineDeltas[0].baseRef,
            fixedCount: baselineDeltas.reduce((total, delta) => total + delta.fixedCount, 0),
            baseTotalCount: baselineDeltas.reduce(
              (total, delta) => total + delta.baseTotalCount,
              0,
            ),
          }
        : undefined;
    writeJsonReport(
      buildJsonReport({
        version: VERSION,
        directory: input.resolvedDirectory,
        mode,
        diff: input.diff,
        scans: filterCompletedScansByCategories(input.completedScans, input.categoryFilters),
        skippedProjects: input.skippedProjects,
        totalElapsedMilliseconds: performance.now() - input.startTime,
        baseline,
        baselineDegraded,
      }),
    );
  }

  if (
    shouldFailScanGate({
      scans: input.completedScans,
      blockingLevel: resolveBlockingLevel(input.flags, input.userConfig),
      diagnosticsAreGateExempt: input.isScoreOnly || baselineDegraded,
    })
  ) {
    process.exitCode = 1;
  }
};
