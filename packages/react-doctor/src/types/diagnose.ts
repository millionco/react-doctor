import type { Diagnostic } from "./diagnostic.js";
import type { ProjectInfo } from "./project-info.js";
import type { ScoreResult } from "./score.js";

export interface DiagnoseOptions {
  lint?: boolean;
  deadCode?: boolean;
  verbose?: boolean;
  includePaths?: string[];
  /**
   * Per-call override for `ReactDoctorConfig.respectInlineDisables`.
   * See that field's docs for the full contract.
   */
  respectInlineDisables?: boolean;
}

export interface DiagnoseResult {
  diagnostics: Diagnostic[];
  score: ScoreResult | null;
  project: ProjectInfo;
  elapsedMilliseconds: number;
}
