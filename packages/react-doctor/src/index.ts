import { defineConfig } from "./core/core-configuration.js";
import type { ReactDoctorConfig } from "./core/core-configuration.js";
import { summarizeDiagnostics } from "./core/core-diagnostic-semantics.js";
import {
  AmbiguousProjectError,
  isProjectDiscoveryError,
  isReactDoctorError,
  NoReactDependencyError,
  NotADirectoryError,
  PackageJsonNotFoundError,
  ProjectNotFoundError,
  ReactDoctorError,
} from "./core/core-errors.js";
import { filterSourceFiles, hasReactRuntime } from "./core/core-project-discovery.js";
import { buildJsonReport, buildJsonReportError } from "./core/core-reporting.js";
import { clearCoreCaches } from "./core/core-scan-cache.js";
import { getDiffInfo } from "./core/core-version-control.js";
import type {
  JsonReport,
  JsonReportDiffInfo,
  JsonReportError,
  JsonReportMode,
  JsonReportProjectEntry,
  JsonReportSummary,
} from "./core/core-reporting.js";
import type {
  Diagnostic,
  DiagnoseOptions,
  DiagnoseProjectsInput,
  DiagnoseProjectsResult,
  DiagnoseResult,
  DiffInfo,
  ProjectDefinition,
  ProjectInfo,
  ProjectResult,
  ProjectResultError,
  ProjectResultOk,
  ScoreResult,
} from "./core/core-types.js";

export type {
  Diagnostic,
  DiagnoseOptions,
  DiagnoseProjectsInput,
  DiagnoseProjectsResult,
  DiagnoseResult,
  DiffInfo,
  JsonReport,
  JsonReportDiffInfo,
  JsonReportError,
  JsonReportMode,
  JsonReportProjectEntry,
  JsonReportSummary,
  ProjectDefinition,
  ProjectInfo,
  ProjectResult,
  ProjectResultError,
  ProjectResultOk,
  ReactDoctorConfig,
  ScoreResult,
};
export {
  AmbiguousProjectError,
  buildJsonReport,
  buildJsonReportError,
  filterSourceFiles,
  getDiffInfo,
  hasReactRuntime,
  isProjectDiscoveryError,
  isReactDoctorError,
  NoReactDependencyError,
  NotADirectoryError,
  PackageJsonNotFoundError,
  ProjectNotFoundError,
  ReactDoctorError,
  summarizeDiagnostics,
  defineConfig,
};
// `ReactDoctorError` is the tagged Schema class from
// `@react-doctor/core`, used by the new Effect pipeline.
// `isReactDoctorError` narrows to that tagged class.
// The five narrow errors below are still plain JS Error subclasses —
// they're thrown synchronously by `discoverProject` /
// `resolveDiagnoseTarget` / `readPackageJson` BEFORE the Effect
// runtime takes over, so callers can `try/catch` them without
// Effect-aware machinery.
// HACK: programmatic API consumers (watch-mode tools, test runners,
// agentic CLI flows) call diagnose() repeatedly on the same directory.
// project / config / package.json results are memoized at module scope
// to keep CLI scans fast — this hook lets long-running consumers
// invalidate when the underlying files change between calls.
export const clearCaches = (): void => {
  clearCoreCaches();
};

interface ToJsonReportOptions {
  version: string;
  directory?: string;
  mode?: JsonReportMode;
}

export const toJsonReport = (result: DiagnoseResult, options: ToJsonReportOptions): JsonReport =>
  buildJsonReport({
    version: options.version,
    directory: options.directory ?? result.project.rootDirectory,
    mode: options.mode ?? "full",
    diff: null,
    scans: [
      {
        directory: result.project.rootDirectory,
        result: {
          diagnostics: result.diagnostics,
          score: result.score,
          skippedChecks: result.skippedChecks,
          ...(result.skippedCheckReasons
            ? { skippedCheckReasons: result.skippedCheckReasons }
            : {}),
          ...(result.analyzedFiles ? { analyzedFiles: result.analyzedFiles } : {}),
          ...(typeof result.scannedFileCount === "number"
            ? { scannedFileCount: result.scannedFileCount }
            : {}),
          project: result.project,
          elapsedMilliseconds: result.elapsedMilliseconds,
        },
      },
    ],
    totalElapsedMilliseconds: result.elapsedMilliseconds,
  });

export { diagnose } from "@react-doctor/api";
