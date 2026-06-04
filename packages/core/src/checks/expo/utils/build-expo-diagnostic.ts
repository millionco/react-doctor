import type { Diagnostic } from "../../../types/index.js";

export interface BuildExpoDiagnosticInput {
  readonly rule: string;
  readonly message: string;
  readonly help: string;
  readonly filePath?: string;
  readonly severity?: Diagnostic["severity"];
  readonly category?: string;
  readonly line?: number;
  readonly column?: number;
}

// Shared shape for every ported Expo project-level diagnostic. Defaults
// match the existing project-level checks (`require-pnpm-hardening`):
// anchored to `package.json` at line 0 since these are whole-manifest
// findings, `plugin: "react-doctor"`, and `warning` severity.
export const buildExpoDiagnostic = (input: BuildExpoDiagnosticInput): Diagnostic => ({
  filePath: input.filePath ?? "package.json",
  plugin: "react-doctor",
  rule: input.rule,
  severity: input.severity ?? "warning",
  message: input.message,
  help: input.help,
  line: input.line ?? 0,
  column: input.column ?? 0,
  category: input.category ?? "Correctness",
});
