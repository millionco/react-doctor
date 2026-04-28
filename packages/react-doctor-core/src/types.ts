export interface OxlintSpan {
  offset: number;
  length: number;
  line: number;
  column: number;
}

export interface OxlintLabel {
  label: string;
  span: OxlintSpan;
}

export interface OxlintDiagnostic {
  message: string;
  code: string;
  severity: "warning" | "error";
  causes: string[];
  url: string;
  help: string;
  filename: string;
  labels: OxlintLabel[];
  related: unknown[];
}

export interface OxlintOutput {
  diagnostics: OxlintDiagnostic[];
  number_of_files: number;
  number_of_rules: number;
}

export interface Diagnostic {
  filePath: string;
  plugin: string;
  rule: string;
  severity: "error" | "warning";
  message: string;
  help: string;
  line: number;
  column: number;
  category: string;
  weight?: number;
}

export interface ScoreResult {
  score: number;
  label: string;
}

export interface CleanedDiagnostic {
  message: string;
  help: string;
}
