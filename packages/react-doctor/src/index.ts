import path from "node:path";
import {
  buildJsonReport,
  buildJsonReportError,
  calculateScore,
  clearAutoSuppressionCaches,
  clearConfigCache,
  clearIgnorePatternsCache,
  combineDiagnostics,
  computeJsxIncludePaths,
  createNodeReadFileLinesSync,
  loadConfigWithSource,
  resolveConfigRootDir,
  resolveDiagnoseTarget,
  resolveLintIncludePaths,
  runOxlint,
} from "@react-doctor/core";
import {
  clearPackageJsonCache,
  clearProjectCache,
  discoverProject,
  NoReactDependencyError,
  ProjectNotFoundError,
} from "@react-doctor/project-info";
import type {
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
} from "@react-doctor/types";

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
export { getDiffInfo, filterSourceFiles, summarizeDiagnostics } from "@react-doctor/core";
export { buildJsonReport, buildJsonReportError };
export {
  ReactDoctorError,
  ProjectNotFoundError,
  NoReactDependencyError,
  PackageJsonNotFoundError,
  AmbiguousProjectError,
  isReactDoctorError,
} from "@react-doctor/project-info";

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
