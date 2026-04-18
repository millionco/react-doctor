import type { Diagnostic, ProjectInfo, ReactDoctorConfig, ScoreResult } from "../../types.js";
import { buildDiagnoseTimedResult } from "../../core/build-result.js";
import { calculateScore as calculateScoreBrowser } from "../../utils/calculate-score-browser.js";
import { createBrowserReadFileLinesSync } from "./create-browser-read-file-lines.js";

export interface BrowserDiagnoseInput {
  rootDirectory: string;
  project: ProjectInfo;
  projectFiles: Record<string, string>;
  lintDiagnostics: Diagnostic[];
  deadCodeDiagnostics?: Diagnostic[];
  userConfig?: ReactDoctorConfig | null;
  score?: ScoreResult | null;
}

export interface BrowserDiagnoseResult {
  diagnostics: Diagnostic[];
  score: ScoreResult | null;
  project: ProjectInfo;
  elapsedMilliseconds: number;
}

export const diagnose = async (input: BrowserDiagnoseInput): Promise<BrowserDiagnoseResult> => {
  if (!input.project.reactVersion) {
    throw new Error("No React dependency found in package.json");
  }

  const readFileLinesSync = createBrowserReadFileLinesSync(input.rootDirectory, input.projectFiles);
  const userConfig = input.userConfig ?? null;
  const deadCodeDiagnostics = input.deadCodeDiagnostics ?? [];
  const mergedDiagnostics = [...input.lintDiagnostics, ...deadCodeDiagnostics];
  const startTime = globalThis.performance.now();

  const timed = await buildDiagnoseTimedResult({
    mergedDiagnostics,
    rootDirectory: input.rootDirectory,
    userConfig,
    readFileLinesSync,
    startTime,
    score: input.score,
    calculateDiagnosticsScore: calculateScoreBrowser,
  });

  return {
    diagnostics: timed.diagnostics,
    score: timed.score,
    project: input.project,
    elapsedMilliseconds: timed.elapsedMilliseconds,
  };
};
