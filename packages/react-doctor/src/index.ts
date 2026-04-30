import path from "node:path";
import type {
  Diagnostic,
  DiffInfo,
  JsonReport,
  JsonReportDiffInfo,
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
import { discoverProject } from "./utils/discover-project.js";
import { loadConfig } from "./utils/load-config.js";
import { createNodeReadFileLinesSync } from "./utils/read-file-lines-node.js";
import { resolveLintIncludePaths } from "./utils/resolve-lint-include-paths.js";
import { calculateScore } from "./utils/calculate-score-node.js";
import { runKnip } from "./utils/run-knip.js";
import { runOxlint } from "./utils/run-oxlint.js";
import { summarizeDiagnostics } from "./utils/summarize-diagnostics.js";

export type {
  Diagnostic,
  DiffInfo,
  JsonReport,
  JsonReportDiffInfo,
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

export interface DiagnoseOptions {
  lint?: boolean;
  deadCode?: boolean;
  includePaths?: string[];
}

export interface DiagnoseResult {
  diagnostics: Diagnostic[];
  score: ScoreResult | null;
  project: ProjectInfo;
  elapsedMilliseconds: number;
}

interface ToJsonReportOptions {
  version?: string;
  directory?: string;
  mode?: JsonReportMode;
}

export const toJsonReport = (
  result: DiagnoseResult,
  options: ToJsonReportOptions = {},
): JsonReport =>
  buildJsonReport({
    version: options.version ?? "0.0.0",
    directory: options.directory ?? result.project.rootDirectory,
    mode: options.mode ?? "full",
    diff: null,
    scans: [
      {
        directory: result.project.rootDirectory,
        result: {
          diagnostics: result.diagnostics,
          scoreResult: result.score,
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
          runOxlint(
            projectRoot,
            projectInfo.hasTypeScript,
            projectInfo.framework,
            projectInfo.hasReactCompiler,
            lintIncludePaths,
            undefined,
            config?.customRulesOnly ?? false,
          ),
        runDeadCode: () => runKnip(projectRoot),
      }),
    },
    { ...options, lintIncludePaths },
  );
};
