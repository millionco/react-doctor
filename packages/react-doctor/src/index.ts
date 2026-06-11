import {
  buildJsonReport,
  buildJsonReportError,
  clearAutoSuppressionCaches,
  clearConfigCache,
  clearIgnorePatternsCache,
  clearPackageJsonCache,
  clearPackageRoleCache,
  clearProjectCache,
} from "@react-doctor/core";
import type {
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
} from "@react-doctor/core";

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
  getDiffInfo,
  filterSourceFiles,
  summarizeDiagnostics,
  defineConfig,
} from "@react-doctor/core";
export { buildJsonReport, buildJsonReportError };
// `ReactDoctorError` is the tagged Schema class from
// `@react-doctor/core`, used by the new Effect pipeline.
// `isReactDoctorError` narrows to that tagged class.
// The four narrow errors below are still plain JS Error subclasses —
// they're thrown synchronously by `discoverProject` /
// `resolveDiagnoseTarget` / `readPackageJson` BEFORE the Effect
// runtime takes over, so callers can `try/catch` them without
// Effect-aware machinery.
export {
  ReactDoctorError,
  ProjectNotFoundError,
  NoReactDependencyError,
  PackageJsonNotFoundError,
  NotADirectoryError,
  AmbiguousProjectError,
  isReactDoctorError,
  isProjectDiscoveryError,
} from "@react-doctor/core";

// HACK: programmatic API consumers (watch-mode tools, test runners,
// agentic CLI flows) call diagnose() repeatedly on the same directory.
// project / config / package.json results are memoized at module scope
// to keep CLI scans fast — this hook lets long-running consumers
// invalidate when the underlying files change between calls.
export const clearCaches = (): void => {
  clearProjectCache();
  clearConfigCache();
  clearPackageJsonCache();
  clearIgnorePatternsCache();
  clearPackageRoleCache();
  clearAutoSuppressionCaches();
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
          project: result.project,
          elapsedMilliseconds: result.elapsedMilliseconds,
        },
      },
    ],
    totalElapsedMilliseconds: result.elapsedMilliseconds,
  });

export { diagnose } from "@react-doctor/api";
