import path from "node:path";
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
import { diagnoseCore } from "./core/diagnose-core.js";
import { computeJsxIncludePaths } from "./utils/jsx-include-paths.js";
import { buildJsonReport } from "./utils/build-json-report.js";
import { buildJsonReportError } from "./utils/build-json-report-error.js";
import { checkReducedMotion } from "./utils/check-reduced-motion.js";
import { clearIgnorePatternsCache } from "./utils/collect-ignore-patterns.js";
import { clearProjectCache, discoverProject } from "./utils/discover-project.js";
import { clearConfigCache, loadConfig } from "./utils/load-config.js";
import { clearPackageJsonCache } from "./utils/read-package-json.js";
import { createNodeReadFileLinesSync } from "./utils/read-file-lines-node.js";
import { resolveLintIncludePaths } from "./utils/resolve-lint-include-paths.js";
import { calculateScore } from "./utils/calculate-score-node.js";
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

export const diagnose = async (
  directory: string,
  options: DiagnoseOptions = {},
): Promise<DiagnoseResult> => {
  const resolvedDirectory = path.resolve(directory);
  const userConfig = loadConfig(resolvedDirectory);
  const includePaths = options.includePaths ?? [];
  const isDiffMode = includePaths.length > 0;
  const lintIncludePaths =
    computeJsxIncludePaths(includePaths) ?? resolveLintIncludePaths(resolvedDirectory, userConfig);
  const readFileLinesSync = createNodeReadFileLinesSync(resolvedDirectory);

  return diagnoseCore(
    {
      rootDirectory: resolvedDirectory,
      readFileLinesSync,
      loadUserConfig: () => userConfig,
      discoverProjectInfo: () => discoverProject(resolvedDirectory),
      calculateDiagnosticsScore: calculateScore,
      getExtraDiagnostics: () => (isDiffMode ? [] : checkReducedMotion(resolvedDirectory)),
      createRunners: ({ resolvedDirectory: projectRoot, projectInfo, userConfig: config }) => ({
        runLint: () =>
          runOxlint({
            rootDirectory: projectRoot,
            hasTypeScript: projectInfo.hasTypeScript,
            framework: projectInfo.framework,
            hasReactCompiler: projectInfo.hasReactCompiler,
            hasTanStackQuery: projectInfo.hasTanStackQuery,
            includePaths: lintIncludePaths,
            customRulesOnly: config?.customRulesOnly ?? false,
            respectInlineDisables:
              options.respectInlineDisables ?? config?.respectInlineDisables ?? true,
          }),
        runDeadCode: () => runKnip(projectRoot),
      }),
    },
    { ...options, lintIncludePaths },
  );
};
