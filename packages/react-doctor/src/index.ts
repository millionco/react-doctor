import path from "node:path";
import { performance } from "node:perf_hooks";
import type { Diagnostic, DiffInfo, ProjectInfo, ReactDoctorConfig, ScoreResult } from "./types.js";
import { calculateScore } from "./utils/calculate-score.js";
import { combineDiagnostics, computeJsxIncludePaths } from "./utils/combine-diagnostics.js";
import { discoverProject } from "./utils/discover-project.js";
import { loadConfig } from "./utils/load-config.js";
import { runKnip } from "./utils/run-knip.js";
import { runOxlint } from "./utils/run-oxlint.js";

export type { Diagnostic, DiffInfo, ProjectInfo, ReactDoctorConfig, ScoreResult };
export { getDiffInfo, filterSourceFiles } from "./utils/get-diff-files.js";

export interface DiagnoseOptions {
  lint?: boolean;
  deadCode?: boolean;
  packageJsonDirectory?: string;
  includePaths?: string[];
}

export interface DiagnoseResult {
  diagnostics: Diagnostic[];
  score: ScoreResult | null;
  project: ProjectInfo;
  elapsedMilliseconds: number;
}

export const diagnose = async (
  directory: string,
  options: DiagnoseOptions = {},
): Promise<DiagnoseResult> => {
  const { packageJsonDirectory, includePaths = [] } = options;
  const isDiffMode = includePaths.length > 0;

  const startTime = performance.now();
  const resolvedDirectory = path.resolve(directory);
  const resolvedPackageJsonDirectory = packageJsonDirectory
    ? path.resolve(packageJsonDirectory)
    : undefined;
  const projectInfo = discoverProject(resolvedDirectory, resolvedPackageJsonDirectory);
  const userConfig = loadConfig(resolvedDirectory);

  const effectiveLint = options.lint ?? userConfig?.lint ?? true;
  const effectiveDeadCode = options.deadCode ?? userConfig?.deadCode ?? true;

  if (!projectInfo.reactVersion) {
    throw new Error("No React dependency found in package.json");
  }

  const jsxIncludePaths = computeJsxIncludePaths(includePaths);

  const emptyDiagnostics: Diagnostic[] = [];

  const lintPromise = effectiveLint
    ? runOxlint(
        resolvedDirectory,
        projectInfo.hasTypeScript,
        projectInfo.framework,
        projectInfo.hasReactCompiler,
        jsxIncludePaths,
      ).catch((error: unknown) => {
        console.error("Lint failed:", error);
        return emptyDiagnostics;
      })
    : Promise.resolve(emptyDiagnostics);

  const deadCodePromise =
    effectiveDeadCode && !isDiffMode
      ? runKnip(resolvedDirectory).catch((error: unknown) => {
          console.error("Dead code analysis failed:", error);
          return emptyDiagnostics;
        })
      : Promise.resolve(emptyDiagnostics);

  const [lintDiagnostics, deadCodeDiagnostics] = await Promise.all([lintPromise, deadCodePromise]);
  const diagnostics = combineDiagnostics(
    lintDiagnostics,
    deadCodeDiagnostics,
    resolvedDirectory,
    isDiffMode,
    userConfig,
  );

  const elapsedMilliseconds = performance.now() - startTime;
  const score = await calculateScore(diagnostics);

  return {
    diagnostics,
    score,
    project: projectInfo,
    elapsedMilliseconds,
  };
};
