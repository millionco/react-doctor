import { lintSource } from "./lint-source.js";
import type { LiteDiagnostic, LiteSource, LoadedRule } from "../types.js";

export interface LintSourcesInput {
  sources: ReadonlyArray<LiteSource>;
  rules: ReadonlyArray<LoadedRule>;
  settings: Readonly<Record<string, unknown>>;
}

// Lints a list of in-memory sources sequentially on the current thread. Used
// directly for small / programmatic inputs and as the per-batch body inside
// each worker thread.
export const lintSourcesInProcess = ({
  sources,
  rules,
  settings,
}: LintSourcesInput): LiteDiagnostic[] => {
  const diagnostics: LiteDiagnostic[] = [];
  for (const source of sources) {
    diagnostics.push(...lintSource({ ...source, rules, settings }));
  }
  return diagnostics;
};
