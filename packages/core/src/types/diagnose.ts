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
 * A single project to scan as part of a `diagnose({ projects })` batch.
 * Scan options (`deadCode`, `lint`, etc.) are flat on the entry and
 * layer on top of the global defaults — omitted fields fall through.
 * `config` layers on top of the batch-level `config` and the project's
 * on-disk `doctor.config.*` (see `mergeReactDoctorConfigs`).
 */
export interface ProjectDefinition extends DiagnoseOptions {
  directory: string;
  /**
   * Per-project react-doctor config overrides. Merged on top of the
   * effective base config (the project's on-disk `doctor.config.*`,
   * then the batch-level `DiagnoseProjectsInput.config`) via
   * `mergeReactDoctorConfigs`: `rules` / `categories` merge per key,
   * `ignore` lists union, and scalar fields are overridden when set —
   * so disabling one rule here keeps every base rule intact.
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
   * Shared react-doctor config overrides applied to every project in
   * the batch. Merged on top of each project's on-disk
   * `doctor.config.*` (per-key for `rules` / `categories`, unioned for
   * `ignore` lists), with each `ProjectDefinition.config` layered on
   * top of that. Use this to keep one base rule set across the batch
   * and override per project only where needed.
   */
  config?: ReactDoctorConfig;
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
