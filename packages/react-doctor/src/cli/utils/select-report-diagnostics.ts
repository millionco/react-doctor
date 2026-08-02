import type { Diagnostic, DiagnosticSurface } from "@react-doctor/core";
import { filterDiagnosticsByCategories } from "./filter-diagnostics-by-categories.js";
import { filterScansForSurface, type SurfaceFilterableScan } from "./filter-scans-for-surface.js";

export interface SelectReportDiagnosticsInput {
  readonly categoryFilters?: ReadonlyArray<string>;
  readonly scan: SurfaceFilterableScan;
  readonly surface?: DiagnosticSurface;
}

export interface SelectedReportDiagnostics {
  readonly diagnostics: Diagnostic[];
  readonly demotedDiagnosticCount: number;
}

export const selectReportDiagnostics = (
  input: SelectReportDiagnosticsInput,
): SelectedReportDiagnostics => {
  const surfaceDiagnostics = filterScansForSurface([input.scan], input.surface ?? "cli");
  return {
    diagnostics: filterDiagnosticsByCategories(surfaceDiagnostics, new Set(input.categoryFilters)),
    demotedDiagnosticCount: input.scan.result.diagnostics.length - surfaceDiagnostics.length,
  };
};
