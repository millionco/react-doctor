import path from "node:path";
import { performance } from "node:perf_hooks";
import type { Diagnostic, ProjectInfo, ScoreResult } from "./types.js";
import { calculateScore } from "./utils/calculate-score.js";
import { checkReducedMotion } from "./utils/check-reduced-motion.js";
import { discoverProject } from "./utils/discover-project.js";
import { runKnip } from "./utils/run-knip.js";
import { runOxlint } from "./utils/run-oxlint.js";

export type { Diagnostic, ProjectInfo, ScoreResult };

export interface DiagnoseOptions {
  lint?: boolean;
  deadCode?: boolean;
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
  const { lint = true, deadCode = true } = options;

  const startTime = performance.now();
  const resolvedDirectory = path.resolve(directory);
  const projectInfo = discoverProject(resolvedDirectory);

  if (!projectInfo.reactVersion) {
    throw new Error("No React dependency found in package.json");
  }

  const lintPromise = lint
    ? runOxlint(
        resolvedDirectory,
        projectInfo.hasTypeScript,
        projectInfo.framework,
        projectInfo.hasReactCompiler,
      ).catch((error: unknown) => {
        console.error("Lint failed:", error);
        return [] as Diagnostic[];
      })
    : Promise.resolve([] as Diagnostic[]);

  const deadCodePromise = deadCode
    ? runKnip(resolvedDirectory).catch((error: unknown) => {
        console.error("Dead code analysis failed:", error);
        return [] as Diagnostic[];
      })
    : Promise.resolve([] as Diagnostic[]);

  const [lintDiagnostics, deadCodeDiagnostics] = await Promise.all([lintPromise, deadCodePromise]);
  const diagnostics = [
    ...lintDiagnostics,
    ...deadCodeDiagnostics,
    ...checkReducedMotion(resolvedDirectory),
  ];

  const elapsedMilliseconds = performance.now() - startTime;
  const score = await calculateScore(diagnostics);

  return {
    diagnostics,
    score,
    project: projectInfo,
    elapsedMilliseconds,
  };
};
