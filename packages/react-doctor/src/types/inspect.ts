import type { ReactDoctorConfig } from "./config.js";
import type { Diagnostic } from "./diagnostic.js";
import type { ProjectInfo } from "./project-info.js";
import type { ScoreResult } from "./score.js";

export interface InspectResult {
  diagnostics: Diagnostic[];
  score: ScoreResult | null;
  skippedChecks: string[];
  project: ProjectInfo;
  elapsedMilliseconds: number;
}

export interface InspectOptions {
  lint?: boolean;
  deadCode?: boolean;
  verbose?: boolean;
  scoreOnly?: boolean;
  offline?: boolean;
  silent?: boolean;
  includePaths?: string[];
  configOverride?: ReactDoctorConfig | null;
  respectInlineDisables?: boolean;
}

export interface DiffInfo {
  currentBranch: string;
  baseBranch: string;
  changedFiles: string[];
  isCurrentChanges?: boolean;
}

export type JsonReportMode = "full" | "diff" | "staged";

export interface JsonReportDiffInfo {
  baseBranch: string;
  currentBranch: string;
  changedFileCount: number;
  isCurrentChanges: boolean;
}

export interface JsonReportProjectEntry {
  directory: string;
  project: ProjectInfo;
  diagnostics: Diagnostic[];
  score: ScoreResult | null;
  skippedChecks: string[];
  elapsedMilliseconds: number;
}

export interface JsonReportSummary {
  errorCount: number;
  warningCount: number;
  affectedFileCount: number;
  totalDiagnosticCount: number;
  score: number | null;
  scoreLabel: string | null;
}

export interface JsonReportError {
  message: string;
  name: string;
  chain: string[];
}

export interface JsonReport {
  schemaVersion: 1;
  version: string;
  ok: boolean;
  directory: string;
  mode: JsonReportMode;
  diff: JsonReportDiffInfo | null;
  projects: JsonReportProjectEntry[];
  /**
   * Flattened across `projects[].diagnostics` for convenience. Equivalent to
   * `projects.flatMap((project) => project.diagnostics)`.
   */
  diagnostics: Diagnostic[];
  summary: JsonReportSummary;
  elapsedMilliseconds: number;
  error: JsonReportError | null;
}
