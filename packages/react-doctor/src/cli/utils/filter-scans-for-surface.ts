import { filterDiagnosticsForSurface } from "@react-doctor/core";
import type {
  Diagnostic,
  DiagnosticSurface,
  InspectResult,
  ReactDoctorConfig,
} from "@react-doctor/core";

export interface SurfaceFilterableScan {
  readonly result: InspectResult;
  /**
   * The merged (root + module) config the scan ran under. Surface
   * filtering must use it — not the invocation-root config — so a
   * module's own `surfaces` controls apply to the aggregate output
   * exactly as they would to a standalone scan of that module.
   */
  readonly config: ReactDoctorConfig | null;
  /**
   * Where to read source from when rendering a code frame, when that is not
   * `result.project.rootDirectory`. A `--staged` scan runs against a snapshot
   * of the index, so the worktree copy can differ from what was scanned —
   * reading it would print the wrong lines under index line numbers.
   */
  readonly frameSourceRoot?: string;
}

export const filterScansForSurface = (
  completedScans: ReadonlyArray<SurfaceFilterableScan>,
  surface: DiagnosticSurface,
): Diagnostic[] =>
  completedScans.flatMap((scan) =>
    filterDiagnosticsForSurface([...scan.result.diagnostics], surface, scan.config),
  );
