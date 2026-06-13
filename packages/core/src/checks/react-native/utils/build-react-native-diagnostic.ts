import type { Diagnostic } from "../../../types/index.js";

export interface BuildReactNativeDiagnosticInput {
  readonly rule: string;
  readonly message: string;
  readonly help: string;
  readonly filePath: string;
  readonly severity?: Diagnostic["severity"];
  readonly category?: string;
  readonly line?: number;
  readonly column?: number;
}

// Shared shape for every React Native project-level diagnostic. Defaults match
// the existing checks: `plugin: "react-doctor"`, anchored at line 0 (these are
// whole-file findings), `Correctness` category, and `warning` severity —
// build-breaking findings opt into `error` explicitly.
export const buildReactNativeDiagnostic = (input: BuildReactNativeDiagnosticInput): Diagnostic => ({
  filePath: input.filePath,
  plugin: "react-doctor",
  rule: input.rule,
  severity: input.severity ?? "warning",
  message: input.message,
  help: input.help,
  line: input.line ?? 0,
  column: input.column ?? 0,
  category: input.category ?? "Correctness",
});
