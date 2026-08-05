import * as Effect from "effect/Effect";
import type {
  DiagnosticSurface,
  InspectResult,
  ReactDoctorConfig,
  ScoreResult,
} from "@react-doctor/core";
import { buildEmptyReportMessage } from "./build-empty-report-message.js";
import { countUniqueScannedFiles } from "./count-unique-scanned-files.js";
import { filterDiagnosticsByCategories } from "./filter-diagnostics-by-categories.js";
import { filterScansForSurface } from "./filter-scans-for-surface.js";
import { printDiagnosticsDump } from "./print-diagnostics-dump.js";
import { printHeadlessReport } from "./print-headless-report.js";

interface CompletedHeadlessScan {
  readonly result: InspectResult;
  readonly config: ReactDoctorConfig | null;
}

interface PrintCompletedScansHeadlessInput {
  readonly categoryFilters: ReadonlySet<string>;
  readonly completedScans: ReadonlyArray<CompletedHeadlessScan>;
  readonly elapsedMilliseconds: number;
  readonly noScoreMessage: string;
  readonly outputDirectory?: string | null;
  readonly outputSurface: DiagnosticSurface;
  readonly projectName: string;
  readonly verbose: boolean;
}

export const printCompletedScansHeadless = (
  input: PrintCompletedScansHeadlessInput,
): Effect.Effect<void> => {
  const surfaceDiagnostics = filterScansForSurface(input.completedScans, input.outputSurface);
  const diagnostics = filterDiagnosticsByCategories(surfaceDiagnostics, input.categoryFilters);
  const allDiagnosticCount = input.completedScans.reduce(
    (total, scan) => total + scan.result.diagnostics.length,
    0,
  );
  const scoreResult = input.completedScans.reduce<ScoreResult | null>((lowestScore, scan) => {
    const scanScore = scan.result.score;
    if (scanScore === null) return lowestScore;
    if (lowestScore === null || scanScore.score < lowestScore.score) return scanScore;
    return lowestScore;
  }, null);
  const skippedChecks = [
    ...new Set(input.completedScans.flatMap((scan) => scan.result.skippedChecks)),
  ];

  return Effect.gen(function* () {
    yield* printHeadlessReport({
      diagnostics,
      elapsedMilliseconds: input.elapsedMilliseconds,
      emptyStateMessage: buildEmptyReportMessage({
        categoryFilters: input.categoryFilters,
        demotedDiagnosticCount: allDiagnosticCount - surfaceDiagnostics.length,
        outputSurface: input.outputSurface,
      }),
      noScoreMessage: input.noScoreMessage,
      projectName: input.projectName,
      scannedFileCount: countUniqueScannedFiles(input.completedScans.map((scan) => scan.result)),
      scoreResult: skippedChecks.length > 0 ? null : scoreResult,
      skippedChecks,
    });
    if (input.outputDirectory !== undefined || input.verbose) {
      yield* printDiagnosticsDump(diagnostics, input.outputDirectory, input.verbose);
    }
  });
};
