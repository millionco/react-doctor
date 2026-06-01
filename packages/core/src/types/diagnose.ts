import type { ReactDoctorConfig } from "./config.js";
import type { Diagnostic } from "./diagnostic.js";
import type { ProjectInfo } from "./project-info.js";
import type { ScoreResult } from "./score.js";

export interface DiagnoseOptions {
  lint?: boolean;
  /** See `ReactDoctorConfig.deadCode`. Ignored in diff mode. */
  deadCode?: boolean;
  verbose?: boolean;
  includePaths?: string[];
  /**
   * Per-call override for `ReactDoctorConfig.respectInlineDisables`.
   * See that field's docs for the full contract.
   */
  respectInlineDisables?: boolean;
  /**
   * Per-call override for `ReactDoctorConfig.warnings`. See that field's
   * docs — `"warning"`-severity diagnostics surface by default unless this
   * (or the config) opts out via `false`.
   */
  warnings?: boolean;
}

export interface DiagnoseResult {
  diagnostics: Diagnostic[];
  score: ScoreResult | null;
  /**
   * Checks that did not run to completion (e.g. `"dead-code"` when the
   * `deslop-js` native binding crashed). Empty when everything ran.
   * Mirrors `InspectResult.skippedChecks`.
   */
  skippedChecks: string[];
  /** See `InspectResult.skippedCheckReasons`. */
  skippedCheckReasons?: Record<string, string>;
  project: ProjectInfo;
  elapsedMilliseconds: number;
}

/**
 * A single project to scan as part of a `diagnoseProjects()` batch.
 * Scan options (`deadCode`, `lint`, etc.) are flat on the entry and
 * layer on top of the global defaults — omitted fields fall through.
 * `config` is a full `ReactDoctorConfig` override that replaces the
 * on-disk `doctor.config.*` for this project's scan.
 */
export interface ProjectDefinition extends DiagnoseOptions {
  directory: string;
  /**
   * Full react-doctor config override for this project. When provided,
   * replaces the on-disk `doctor.config.*` for this project's
   * scan — the scan target resolver still runs (so `rootDir` and
   * subproject discovery work), but its loaded config is swapped out.
   */
  config?: ReactDoctorConfig;
}

export interface ProjectResultOk extends DiagnoseResult {
  ok: true;
  directory: string;
}

export interface ProjectResultError {
  ok: false;
  directory: string;
  error: Error;
}

export type ProjectResult = ProjectResultOk | ProjectResultError;

export interface DiagnoseProjectsInput extends DiagnoseOptions {
  projects: ProjectDefinition[];
  /**
   * Maximum number of projects to scan concurrently. Defaults to the
   * number of projects (fully parallel). Set to `1` for sequential
   * execution. Values below 1 are clamped to 1.
   */
  concurrency?: number;
}

export interface DiagnoseProjectsResult {
  projects: ProjectResult[];
  diagnostics: Diagnostic[];
  score: ScoreResult | null;
  elapsedMilliseconds: number;
}
