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

/**
 * A secondary source location attached to a diagnostic (oxlint's
 * non-primary labels). Editors render these as
 * `Diagnostic.relatedInformation` so a user can jump from, say, a
 * `no-derived-state` finding to the originating prop declaration.
 * Positions mirror `Diagnostic` semantics: `line` / `column` are
 * 1-indexed, and `offset` / `length` are UTF-8 byte spans from oxlint
 * when available (preferred for precise ranges).
 */
export interface DiagnosticRelatedLocation {
  filePath: string;
  line: number;
  column: number;
  offset?: number;
  length?: number;
  endLine?: number;
  endColumn?: number;
  message: string;
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
  /**
   * UTF-8 byte offset of the diagnostic's primary span start, straight
   * from oxlint's label span. Optional because environment / dead-code
   * diagnostics carry no source span. Editors (LSP) convert this into a
   * precise range via the in-memory document; non-editor consumers can
   * ignore it.
   */
  offset?: number;
  /** UTF-8 byte length of the primary span (pairs with `offset`). */
  length?: number;
  /** 1-indexed end line of the primary span, when derivable. */
  endLine?: number;
  /** 1-indexed end column of the primary span, when derivable. */
  endColumn?: number;
  category: string;
  suppressionHint?: string;
  /** Secondary source locations (oxlint's non-primary labels). */
  relatedLocations?: DiagnosticRelatedLocation[];
}

export interface CleanedDiagnostic {
  message: string;
  help: string;
}
