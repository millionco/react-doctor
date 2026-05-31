interface OxlintSpan {
  offset: number;
  length: number;
  line: number;
  column: number;
}

interface OxlintLabel {
  label: string;
  span: OxlintSpan;
}

interface OxlintDiagnostic {
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
  // Short human headline for the rule (e.g. "Array index used as a key").
  // Present for react-doctor rules; absent for adopted third-party rules,
  // where renderers fall back to the `plugin/rule` id.
  title?: string;
  message: string;
  help: string;
  url?: string;
  line: number;
  column: number;
  category: string;
  suppressionHint?: string;
}

export interface CleanedDiagnostic {
  message: string;
  help: string;
}
