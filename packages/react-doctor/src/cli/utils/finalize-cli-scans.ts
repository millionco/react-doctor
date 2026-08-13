import { performance } from "node:perf_hooks";
import {
  buildJsonReport,
  type DiffInfo,
  type JsonReportMode,
  type JsonReportSkippedProject,
  type ReactDoctorConfig,
} from "@react-doctor/core";
import { buildFinalCliScanOutcome, type CompletedScan } from "./build-final-cli-scan-outcome.js";
import { cliLogger as logger } from "./cli-logger.js";
import { METRIC } from "./constants.js";
import { formatSkippedProjectsMessage } from "./format-skipped-projects-message.js";
import type { InspectFlags } from "./inspect-flags.js";
import { writeJsonReport } from "./json-mode.js";
import { recordCount } from "./record-metric.js";
import { resolveBlockingLevel } from "./resolve-blocking-level.js";
import { shouldFailScanGate } from "./should-fail-scan-gate.js";
import { VERSION } from "./version.js";

export type { CompletedScan } from "./build-final-cli-scan-outcome.js";

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
  const outcome = buildFinalCliScanOutcome({
    completedScans: input.completedScans,
    skippedProjects: input.skippedProjects,
    mode: input.mode,
    baselineIntended: input.baselineIntended,
    categoryFilters: input.categoryFilters,
  });

  if (outcome.shouldWarnNoSupportedLibraryDetected) {
    recordCount(METRIC.scanNoReactDetected, 1);
    logger.warn(
      `No supported framework or library detected at ${input.resolvedDirectory} — library-specific rules were gated off; framework-neutral rules still ran.`,
    );
  }

  if (input.isJsonMode) {
    writeJsonReport(
      buildJsonReport({
        version: VERSION,
        directory: input.resolvedDirectory,
        mode: outcome.mode,
        diff: input.diff,
        scans: outcome.scansForJsonReport,
        skippedProjects: input.skippedProjects,
        totalElapsedMilliseconds: performance.now() - input.startTime,
        baseline: outcome.baseline,
        baselineDegraded: outcome.baselineDegraded,
      }),
    );
  }

  if (
    shouldFailScanGate({
      scans: input.completedScans,
      blockingLevel: resolveBlockingLevel(input.flags, input.userConfig),
      diagnosticsAreGateExempt: input.isScoreOnly || outcome.baselineDegraded,
    })
  ) {
    process.exitCode = 1;
  }
};
