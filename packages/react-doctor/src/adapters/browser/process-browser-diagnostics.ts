import type { Diagnostic, ReactDoctorConfig, ScoreResult } from "../../types.js";
import { buildDiagnoseTimedResult } from "../../core/build-result.js";
import { calculateScore as calculateScoreBrowser } from "../../utils/calculate-score-browser.js";
import { createBrowserReadFileLinesSync } from "./create-browser-read-file-lines.js";

export interface ProcessBrowserDiagnosticsInput {
  rootDirectory: string;
  projectFiles: Record<string, string>;
  diagnostics: Diagnostic[];
  userConfig?: ReactDoctorConfig | null;
  score?: ScoreResult | null;
}

export interface ProcessBrowserDiagnosticsResult {
  diagnostics: Diagnostic[];
  score: ScoreResult | null;
}

export const processBrowserDiagnostics = async (
  input: ProcessBrowserDiagnosticsInput,
): Promise<ProcessBrowserDiagnosticsResult> => {
  const readFileLinesSync = createBrowserReadFileLinesSync(input.rootDirectory, input.projectFiles);
  const userConfig = input.userConfig ?? null;
  const timed = await buildDiagnoseTimedResult({
    mergedDiagnostics: input.diagnostics,
    rootDirectory: input.rootDirectory,
    userConfig,
    readFileLinesSync,
    startTime: globalThis.performance.now(),
    score: input.score,
    calculateDiagnosticsScore: calculateScoreBrowser,
  });
  return { diagnostics: timed.diagnostics, score: timed.score };
};
