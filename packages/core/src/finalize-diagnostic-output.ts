import type { Diagnostic, DiagnosticSurface, ReactDoctorConfig } from "./types/index.js";
import { filterDiagnosticsForSurface } from "./filter-for-surface.js";
import { assignFixGroups } from "./utils/assign-fix-groups.js";
import { sortDiagnosticsStable } from "./utils/sort-diagnostics-stable.js";

export interface FinalizeDiagnosticOutputInput {
  readonly environmentDiagnostics: ReadonlyArray<Diagnostic>;
  readonly securityDiagnostics: ReadonlyArray<Diagnostic>;
  readonly supplyChainDiagnostics: ReadonlyArray<Diagnostic>;
  readonly lintDiagnostics: ReadonlyArray<Diagnostic>;
  readonly deadCodeDiagnostics: ReadonlyArray<Diagnostic>;
  readonly scoreSurface: DiagnosticSurface;
  readonly userConfig: ReactDoctorConfig | null;
}

export interface FinalizedDiagnosticOutput {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly scoreDiagnostics: ReadonlyArray<Diagnostic>;
}

export const finalizeDiagnosticOutput = (
  input: FinalizeDiagnosticOutputInput,
): FinalizedDiagnosticOutput => {
  const diagnostics = sortDiagnosticsStable(
    assignFixGroups([
      ...input.environmentDiagnostics,
      ...input.securityDiagnostics,
      ...input.supplyChainDiagnostics,
      ...input.lintDiagnostics,
      ...input.deadCodeDiagnostics,
    ]),
  );
  const scoreDiagnostics = filterDiagnosticsForSurface(
    diagnostics,
    input.scoreSurface,
    input.userConfig,
  );
  return { diagnostics, scoreDiagnostics };
};
