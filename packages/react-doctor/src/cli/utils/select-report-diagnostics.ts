import type { Diagnostic, DiagnosticSurface } from "@react-doctor/core";
import { filterDiagnosticsByCategories } from "./filter-diagnostics-by-categories.js";
import { filterScansForSurface, type SurfaceFilterableScan } from "./filter-scans-for-surface.js";

export interface SelectReportDiagnosticsInput {
  readonly categoryFilters?: ReadonlyArray<string>;
  readonly scan: SurfaceFilterableScan;
  readonly surface?: DiagnosticSurface;
}

export const selectReportDiagnostics = (input: SelectReportDiagnosticsInput): Diagnostic[] =>
  filterDiagnosticsByCategories(
    filterScansForSurface([input.scan], input.surface ?? "cli"),
    new Set(input.categoryFilters),
  );
