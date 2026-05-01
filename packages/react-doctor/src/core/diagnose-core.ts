import { buildNoReactDependencyError } from "../constants.js";
import type { Diagnostic, ProjectInfo, ReactDoctorConfig, ScoreResult } from "../types.js";
import { buildDiagnoseTimedResult } from "./build-result.js";
import { computeJsxIncludePaths } from "../utils/jsx-include-paths.js";

export interface DiagnoseCoreOptions {
  lint?: boolean;
  deadCode?: boolean;
  includePaths?: string[];
  lintIncludePaths?: string[] | undefined;
}

export interface DiagnoseCoreResult {
  diagnostics: Diagnostic[];
  score: ScoreResult | null;
  project: ProjectInfo;
  elapsedMilliseconds: number;
}

interface DiagnoseRunnerContext {
  resolvedDirectory: string;
  projectInfo: ProjectInfo;
  userConfig: ReactDoctorConfig | null;
  lintIncludePaths: string[] | undefined;
  isDiffMode: boolean;
}

interface DiagnoseCoreDeps {
  rootDirectory: string;
  readFileLinesSync: (filePath: string) => string[] | null;
  loadUserConfig: () => ReactDoctorConfig | null;
  discoverProjectInfo: () => ProjectInfo;
  calculateDiagnosticsScore: (diagnostics: Diagnostic[]) => Promise<ScoreResult | null>;
  getExtraDiagnostics?: () => Diagnostic[];
  createRunners: (context: DiagnoseRunnerContext) => {
    runLint: () => Promise<Diagnostic[]>;
    runDeadCode: () => Promise<Diagnostic[]>;
  };
}

export const diagnoseCore = async (
  deps: DiagnoseCoreDeps,
  options: DiagnoseCoreOptions = {},
): Promise<DiagnoseCoreResult> => {
  const { includePaths = [] } = options;
  const isDiffMode = includePaths.length > 0;

  const startTime = globalThis.performance.now();
  const resolvedDirectory = deps.rootDirectory;
  const projectInfo = deps.discoverProjectInfo();
  const userConfig = deps.loadUserConfig();

  const effectiveLint = options.lint ?? userConfig?.lint ?? true;
  const effectiveDeadCode = options.deadCode ?? userConfig?.deadCode ?? true;

  if (!projectInfo.reactVersion) {
    throw new Error(buildNoReactDependencyError(deps.rootDirectory));
  }

  const lintIncludePaths =
    options.lintIncludePaths !== undefined
      ? options.lintIncludePaths
      : computeJsxIncludePaths(includePaths);

  const { runLint, runDeadCode } = deps.createRunners({
    resolvedDirectory,
    projectInfo,
    userConfig,
    lintIncludePaths,
    isDiffMode,
  });

  const emptyDiagnostics: Diagnostic[] = [];

  const lintPromise = effectiveLint
    ? runLint().catch((error: unknown) => {
        console.error("Lint failed:", error);
        return emptyDiagnostics;
      })
    : Promise.resolve(emptyDiagnostics);

  const deadCodePromise =
    effectiveDeadCode && !isDiffMode
      ? runDeadCode().catch((error: unknown) => {
          console.error("Dead code analysis failed:", error);
          return emptyDiagnostics;
        })
      : Promise.resolve(emptyDiagnostics);

  // HACK: both runners catch their own errors today, but `Promise.allSettled`
  // is the load-bearing safety net for the case where a future runner
  // is refactored without a `.catch()`. Surfacing the rejection via
  // `console.error` and returning [] keeps `diagnose()` resilient and
  // is cheaper than a second look at the bug-report log.
  const [lintSettled, deadCodeSettled] = await Promise.allSettled([lintPromise, deadCodePromise]);
  const lintDiagnostics = lintSettled.status === "fulfilled" ? lintSettled.value : emptyDiagnostics;
  const deadCodeDiagnostics =
    deadCodeSettled.status === "fulfilled" ? deadCodeSettled.value : emptyDiagnostics;
  if (lintSettled.status === "rejected") {
    console.error("Lint rejected:", lintSettled.reason);
  }
  if (deadCodeSettled.status === "rejected") {
    console.error("Dead code rejected:", deadCodeSettled.reason);
  }
  const environmentDiagnostics = deps.getExtraDiagnostics?.() ?? [];
  const mergedDiagnostics = [...lintDiagnostics, ...deadCodeDiagnostics, ...environmentDiagnostics];
  const timed = await buildDiagnoseTimedResult({
    mergedDiagnostics,
    rootDirectory: resolvedDirectory,
    userConfig,
    readFileLinesSync: deps.readFileLinesSync,
    startTime,
    calculateDiagnosticsScore: deps.calculateDiagnosticsScore,
  });

  return {
    diagnostics: timed.diagnostics,
    score: timed.score,
    project: projectInfo,
    elapsedMilliseconds: timed.elapsedMilliseconds,
  };
};
