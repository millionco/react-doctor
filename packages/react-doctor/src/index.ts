import path from "node:path";
import { NoReactDependencyError, ProjectNotFoundError } from "./errors.js";
import type { ReactDoctorConfig } from "./types/config.js";
import type { DiagnoseOptions, DiagnoseResult } from "./types/diagnose.js";
import type { Diagnostic } from "./types/diagnostic.js";
import type {
  DiffInfo,
  JsonReport,
  JsonReportDiffInfo,
  JsonReportError,
  JsonReportMode,
  JsonReportProjectEntry,
  JsonReportSummary,
} from "./types/inspect.js";
import type { ProjectInfo } from "./types/project-info.js";
import type { ScoreResult } from "./types/score.js";
import { buildJsonReport } from "./core/build-json-report.js";
import { buildJsonReportError } from "./core/build-json-report-error.js";
import { calculateScore } from "./core/calculate-score.js";
import { clearIgnorePatternsCache } from "./core/collect-ignore-patterns.js";
import { combineDiagnostics } from "./core/combine-diagnostics.js";
import { clearAutoSuppressionCaches } from "./core/merge-and-filter-diagnostics.js";
import { clearProjectCache, discoverProject } from "./core/discover-project.js";
import { computeJsxIncludePaths } from "./core/jsx-include-paths.js";
import { clearConfigCache, loadConfigWithSource } from "./core/load-config.js";
import { clearPackageJsonCache } from "./core/read-package-json.js";
import { createNodeReadFileLinesSync } from "./core/read-file-lines-node.js";
import { resolveConfigRootDir } from "./core/resolve-config-root-dir.js";
import { resolveDiagnoseTarget } from "./core/resolve-diagnose-target.js";
import { resolveLintIncludePaths } from "./core/resolve-lint-include-paths.js";
import { runOxlint } from "./core/run-oxlint.js";

export type {
  Diagnostic,
  DiagnoseOptions,
  DiagnoseResult,
  DiffInfo,
  JsonReport,
  JsonReportDiffInfo,
  JsonReportError,
  JsonReportMode,
  JsonReportProjectEntry,
  JsonReportSummary,
  ProjectInfo,
  ReactDoctorConfig,
  ScoreResult,
};
export { getDiffInfo, filterSourceFiles } from "./core/get-diff-files.js";
export { summarizeDiagnostics } from "./core/summarize-diagnostics.js";
export { buildJsonReport, buildJsonReportError };
export {
  ReactDoctorError,
  ProjectNotFoundError,
  NoReactDependencyError,
  PackageJsonNotFoundError,
  AmbiguousProjectError,
  isReactDoctorError,
} from "./errors.js";

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
          skippedChecks: [],
          project: result.project,
          elapsedMilliseconds: result.elapsedMilliseconds,
        },
      },
    ],
    totalElapsedMilliseconds: result.elapsedMilliseconds,
  });

const EMPTY_DIAGNOSTICS: Diagnostic[] = [];

export const diagnose = async (
  directory: string,
  options: DiagnoseOptions = {},
): Promise<DiagnoseResult> => {
  const startTime = globalThis.performance.now();
  const requestedDirectory = path.resolve(directory);

  // Load config first against the requested directory so a `rootDir`
  // redirect applies BEFORE we hunt for nested React subprojects. This
  // is the documented escape hatch for monorepos that hold the only
  // react-doctor config at the repo root but want scans to target a
  // subproject like `apps/web`.
  const initialLoadedConfig = loadConfigWithSource(requestedDirectory);
  const redirectedDirectory = resolveConfigRootDir(
    initialLoadedConfig?.config ?? null,
    initialLoadedConfig?.sourceDirectory ?? null,
  );
  const directoryAfterRedirect = redirectedDirectory ?? requestedDirectory;

  const resolvedDirectory = resolveDiagnoseTarget(directoryAfterRedirect);
  if (!resolvedDirectory) {
    throw new ProjectNotFoundError(directoryAfterRedirect);
  }

  const userConfig =
    initialLoadedConfig?.config ?? loadConfigWithSource(resolvedDirectory)?.config ?? null;
  const includePaths = options.includePaths ?? [];
  const isDiffMode = includePaths.length > 0;
  const projectInfo = discoverProject(resolvedDirectory);

  if (!projectInfo.reactVersion) {
    throw new NoReactDependencyError(resolvedDirectory);
  }

  const lintIncludePaths =
    computeJsxIncludePaths(includePaths) ?? resolveLintIncludePaths(resolvedDirectory, userConfig);
  const readFileLinesSync = createNodeReadFileLinesSync(resolvedDirectory);

  const effectiveLint = options.lint ?? userConfig?.lint ?? true;
  const effectiveRespectInlineDisables =
    options.respectInlineDisables ?? userConfig?.respectInlineDisables ?? true;

  const ignoredTags = new Set<string>(userConfig?.ignore?.tags ?? []);

  const lintDiagnostics = effectiveLint
    ? await runOxlint({
        rootDirectory: resolvedDirectory,
        project: projectInfo,
        includePaths: lintIncludePaths,
        customRulesOnly: userConfig?.customRulesOnly ?? false,
        respectInlineDisables: effectiveRespectInlineDisables,
        adoptExistingLintConfig: userConfig?.adoptExistingLintConfig ?? true,
        ignoredTags,
      }).catch((error: unknown) => {
        console.error("Lint failed:", error);
        return EMPTY_DIAGNOSTICS;
      })
    : EMPTY_DIAGNOSTICS;

  const diagnostics = combineDiagnostics({
    lintDiagnostics,
    directory: resolvedDirectory,
    isDiffMode,
    userConfig,
    readFileLinesSync,
    respectInlineDisables: effectiveRespectInlineDisables,
  });
  const elapsedMilliseconds = globalThis.performance.now() - startTime;
  const score = await calculateScore(diagnostics);

  return { diagnostics, score, project: projectInfo, elapsedMilliseconds };
};
