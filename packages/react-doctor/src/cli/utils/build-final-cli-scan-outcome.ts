import {
  hasSupportedFrameworkOrLibrary,
  type InspectResult,
  type JsonReportMode,
  type JsonReportSkippedProject,
  type ReactDoctorConfig,
} from "@react-doctor/core";
import { filterDiagnosticsByCategories } from "./filter-diagnostics-by-categories.js";

export interface CompletedScan {
  readonly directory: string;
  readonly result: InspectResult;
  readonly config: ReactDoctorConfig | null;
}

export interface AggregatedBaselineDelta {
  readonly baseRef: string;
  readonly fixedCount: number;
  readonly baseTotalCount: number;
}

export interface BuildFinalCliScanOutcomeInput {
  readonly completedScans: ReadonlyArray<CompletedScan>;
  readonly skippedProjects: ReadonlyArray<JsonReportSkippedProject>;
  readonly mode: JsonReportMode;
  readonly baselineIntended: boolean;
  readonly categoryFilters: ReadonlySet<string>;
}

export interface FinalCliScanOutcome {
  readonly baseline: AggregatedBaselineDelta | undefined;
  readonly baselineDegraded: boolean;
  readonly mode: JsonReportMode;
  readonly scansForJsonReport: ReadonlyArray<CompletedScan>;
  readonly shouldWarnNoSupportedLibraryDetected: boolean;
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

export const buildFinalCliScanOutcome = (
  input: BuildFinalCliScanOutcomeInput,
): FinalCliScanOutcome => {
  const baselineDeltas = input.completedScans.flatMap((scan) =>
    scan.result.baselineDelta === undefined ? [] : [scan.result.baselineDelta],
  );
  const baselineComputed =
    input.skippedProjects.length === 0 &&
    input.completedScans.length > 0 &&
    input.completedScans.every((scan) => scan.result.baselineDelta !== undefined);
  const baselineDegraded = input.baselineIntended && !baselineComputed;
  const baseline =
    baselineComputed && baselineDeltas.length > 0
      ? {
          baseRef: baselineDeltas[0].baseRef,
          fixedCount: baselineDeltas.reduce((total, delta) => total + delta.fixedCount, 0),
          baseTotalCount: baselineDeltas.reduce((total, delta) => total + delta.baseTotalCount, 0),
        }
      : undefined;

  return {
    baseline,
    baselineDegraded,
    mode: baselineDegraded ? "diff" : input.mode,
    scansForJsonReport: filterCompletedScansByCategories(
      input.completedScans,
      input.categoryFilters,
    ),
    shouldWarnNoSupportedLibraryDetected:
      input.completedScans.length > 0 &&
      !input.completedScans.some((scan) => hasSupportedFrameworkOrLibrary(scan.result.project)),
  };
};
