import type { Diagnostic, ProjectInfo, ScoreResult } from "../types.js";

interface BuildDiagnoseResultParams {
  diagnostics: Diagnostic[];
  project: ProjectInfo;
  elapsedMilliseconds: number;
  score: ScoreResult | null;
}

interface DiagnoseResultShape {
  diagnostics: Diagnostic[];
  score: ScoreResult | null;
  project: ProjectInfo;
  elapsedMilliseconds: number;
}

export const buildDiagnoseResult = (params: BuildDiagnoseResultParams): DiagnoseResultShape => ({
  diagnostics: params.diagnostics,
  score: params.score,
  project: params.project,
  elapsedMilliseconds: params.elapsedMilliseconds,
});
