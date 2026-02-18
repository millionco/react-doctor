import path from "node:path";
import { performance } from "node:perf_hooks";
import { JSX_FILE_PATTERN } from "./constants.js";
import type { Diagnostic, DiffInfo, ProjectInfo, ReactDoctorConfig, ScoreResult } from "./types.js";
import { calculateScore } from "./utils/calculate-score.js";
import { checkReducedMotion } from "./utils/check-reduced-motion.js";
import { discoverProject } from "./utils/discover-project.js";
import { filterIgnoredDiagnostics } from "./utils/filter-diagnostics.js";
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

  const jsxIncludePaths = isDiffMode
    ? includePaths.filter((filePath) => JSX_FILE_PATTERN.test(filePath))
    : undefined;

  const lintPromise = effectiveLint
    ? runOxlint(
        resolvedDirectory,
        projectInfo.hasTypeScript,
        projectInfo.framework,
        projectInfo.hasReactCompiler,
        jsxIncludePaths,
      ).catch((error: unknown) => {
        console.error("Lint failed:", error);
        return [] as Diagnostic[];
      })
    : Promise.resolve([] as Diagnostic[]);

  const deadCodePromise =
    effectiveDeadCode && !isDiffMode
      ? runKnip(resolvedDirectory).catch((error: unknown) => {
          console.error("Dead code analysis failed:", error);
          return [] as Diagnostic[];
        })
      : Promise.resolve([] as Diagnostic[]);

  const [lintDiagnostics, deadCodeDiagnostics] = await Promise.all([lintPromise, deadCodePromise]);
  const allDiagnostics = [
    ...lintDiagnostics,
    ...deadCodeDiagnostics,
    ...(isDiffMode ? [] : checkReducedMotion(resolvedDirectory)),
  ];
  const diagnostics = userConfig
    ? filterIgnoredDiagnostics(allDiagnostics, userConfig)
    : allDiagnostics;

  const elapsedMilliseconds = performance.now() - startTime;
  const score = await calculateScore(diagnostics);

  return {
    diagnostics,
    score,
    project: projectInfo,
    elapsedMilliseconds,
  };
};
