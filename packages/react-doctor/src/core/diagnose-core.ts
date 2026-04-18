import type { Diagnostic, ProjectInfo, ReactDoctorConfig, ScoreResult } from "../types.js";
import { buildDiagnoseResult } from "./build-diagnose-result.js";
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

export interface DiagnoseRunnerContext {
  resolvedDirectory: string;
  projectInfo: ProjectInfo;
  userConfig: ReactDoctorConfig | null;
  lintIncludePaths: string[] | undefined;
  isDiffMode: boolean;
}

export interface DiagnoseCoreDeps {
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
    throw new Error("No React dependency found in package.json");
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

  const [lintDiagnostics, deadCodeDiagnostics] = await Promise.all([lintPromise, deadCodePromise]);
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

  return buildDiagnoseResult({
    diagnostics: timed.diagnostics,
    score: timed.score,
    project: projectInfo,
    elapsedMilliseconds: timed.elapsedMilliseconds,
  });
};
