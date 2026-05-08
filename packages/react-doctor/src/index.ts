import path from "node:path";
import { buildNoReactDependencyError } from "./constants.js";
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
} from "./types.js";
import { buildJsonReport } from "./utils/build-json-report.js";
import { buildJsonReportError } from "./utils/build-json-report-error.js";
import { calculateScore } from "./utils/calculate-score.js";
import { checkReducedMotion } from "./utils/check-reduced-motion.js";
import { clearIgnorePatternsCache } from "./utils/collect-ignore-patterns.js";
import { clearProjectCache, discoverProject } from "./utils/discover-project.js";
import { computeJsxIncludePaths } from "./utils/jsx-include-paths.js";
import { clearConfigCache, loadConfig } from "./utils/load-config.js";
import { mergeAndFilterDiagnostics } from "./utils/merge-and-filter-diagnostics.js";
import { clearPackageJsonCache } from "./utils/read-package-json.js";
import { createNodeReadFileLinesSync } from "./utils/read-file-lines-node.js";
import { resolveLintIncludePaths } from "./utils/resolve-lint-include-paths.js";
import { runKnip } from "./utils/run-knip.js";
import { runOxlint } from "./utils/run-oxlint.js";

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
export { getDiffInfo, filterSourceFiles } from "./utils/get-diff-files.js";
export { summarizeDiagnostics } from "./utils/summarize-diagnostics.js";
export { buildJsonReport, buildJsonReportError };

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

const settledOrEmpty = <T extends Diagnostic[]>(
  settled: PromiseSettledResult<T>,
  label: string,
): T | Diagnostic[] => {
  if (settled.status === "fulfilled") return settled.value;
  console.error(`${label} rejected:`, settled.reason);
  return EMPTY_DIAGNOSTICS;
};

export const diagnose = async (
  directory: string,
  options: DiagnoseOptions = {},
): Promise<DiagnoseResult> => {
  const startTime = globalThis.performance.now();
  const resolvedDirectory = path.resolve(directory);
  const userConfig = loadConfig(resolvedDirectory);
  const includePaths = options.includePaths ?? [];
  const isDiffMode = includePaths.length > 0;
  const projectInfo = discoverProject(resolvedDirectory);

  if (!projectInfo.reactVersion) {
    throw new Error(buildNoReactDependencyError(resolvedDirectory));
  }

  const lintIncludePaths =
    computeJsxIncludePaths(includePaths) ?? resolveLintIncludePaths(resolvedDirectory, userConfig);
  const readFileLinesSync = createNodeReadFileLinesSync(resolvedDirectory);

  const effectiveLint = options.lint ?? userConfig?.lint ?? true;
  const effectiveDeadCode = options.deadCode ?? userConfig?.deadCode ?? true;
  const effectiveRespectInlineDisables =
    options.respectInlineDisables ?? userConfig?.respectInlineDisables ?? true;

  const lintPromise = effectiveLint
    ? runOxlint({
        rootDirectory: resolvedDirectory,
        hasTypeScript: projectInfo.hasTypeScript,
        framework: projectInfo.framework,
        hasReactCompiler: projectInfo.hasReactCompiler,
        hasTanStackQuery: projectInfo.hasTanStackQuery,
        includePaths: lintIncludePaths,
        customRulesOnly: userConfig?.customRulesOnly ?? false,
        respectInlineDisables: effectiveRespectInlineDisables,
        adoptExistingLintConfig: userConfig?.adoptExistingLintConfig ?? true,
      }).catch((error: unknown) => {
        console.error("Lint failed:", error);
        return EMPTY_DIAGNOSTICS;
      })
    : Promise.resolve(EMPTY_DIAGNOSTICS);

  const deadCodePromise =
    effectiveDeadCode && !isDiffMode
      ? runKnip(resolvedDirectory).catch((error: unknown) => {
          console.error("Dead code analysis failed:", error);
          return EMPTY_DIAGNOSTICS;
        })
      : Promise.resolve(EMPTY_DIAGNOSTICS);

  // HACK: both runners catch their own errors today, but `Promise.allSettled`
  // is the load-bearing safety net for the case where a future runner
  // is refactored without a `.catch()`. Surfacing the rejection via
  // `console.error` and returning [] keeps `diagnose()` resilient and
  // is cheaper than a second look at the bug-report log.
  const [lintSettled, deadCodeSettled] = await Promise.allSettled([lintPromise, deadCodePromise]);
  const lintDiagnostics = settledOrEmpty(lintSettled, "Lint");
  const deadCodeDiagnostics = settledOrEmpty(deadCodeSettled, "Dead code");
  const environmentDiagnostics = isDiffMode ? [] : checkReducedMotion(resolvedDirectory);

  const diagnostics = mergeAndFilterDiagnostics(
    [...lintDiagnostics, ...deadCodeDiagnostics, ...environmentDiagnostics],
    resolvedDirectory,
    userConfig,
    readFileLinesSync,
    { respectInlineDisables: effectiveRespectInlineDisables },
  );
  const elapsedMilliseconds = globalThis.performance.now() - startTime;
  const score = await calculateScore(diagnostics);

  return { diagnostics, score, project: projectInfo, elapsedMilliseconds };
};
