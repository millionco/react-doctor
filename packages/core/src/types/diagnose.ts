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
 * A single module (directory) to scan as part of a `diagnoseModules()`
 * batch. Per-module `config` overrides layer on top of the global
 * `DiagnoseModulesOptions` — omitted fields fall through to the global
 * defaults, and per-module `ReactDoctorConfig` overrides take
 * precedence over any on-disk config file found in the module
 * directory.
 */
export interface ModuleDefinition {
  directory: string;
  config?: DiagnoseOptions & {
    /**
     * Full react-doctor config override for this module. When provided,
     * replaces the on-disk `react-doctor.config.json` for this module's
     * scan — the scan target resolver still runs (so `rootDir` and
     * subproject discovery work), but its loaded config is swapped out.
     */
    reactDoctorConfig?: ReactDoctorConfig;
  };
}

export interface ModuleResult extends DiagnoseResult {
  directory: string;
}

export interface ModuleError {
  directory: string;
  error: Error;
}

export interface DiagnoseModulesOptions extends DiagnoseOptions {
  /**
   * Maximum number of modules to scan concurrently. Defaults to the
   * number of modules (fully parallel). Set to `1` for sequential
   * execution. Values below 1 are clamped to 1.
   */
  concurrency?: number;
}

export interface DiagnoseModulesResult {
  modules: ModuleResult[];
  /**
   * Modules whose scans failed (e.g. `NoReactDependencyError`,
   * `ProjectNotFoundError`). Succeeded modules are in `modules`;
   * failed ones land here so callers always receive partial results.
   */
  errors: ModuleError[];
  diagnostics: Diagnostic[];
  score: ScoreResult | null;
  elapsedMilliseconds: number;
}
