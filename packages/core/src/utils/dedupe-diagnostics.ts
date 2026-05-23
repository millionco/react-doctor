import type { Diagnostic } from "../types/index.js";

// HACK: oxlint plugin rules occasionally emit the same diagnostic
// twice (e.g. when a rule's listener visits the same AST node through
// two overlapping selectors). The duplicates have identical filePath,
// line, column, plugin, rule, message, and severity. This safety net
// collapses them on the react-doctor side so downstream consumers
// (renderer, JSON output, score API) always see one diagnostic per
// unique site — independent of plugin-rule correctness.
//
// Field selection rationale: position + plugin + rule + message +
// severity are the user-visible identity of a diagnostic. `help`,
// `url`, and `category` are deterministically derived from
// (plugin, rule), so they don't need to participate in the key.
export const dedupeDiagnostics = (diagnostics: Diagnostic[]): Diagnostic[] => {
  const seenKeys = new Set<string>();
  const uniqueDiagnostics: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.filePath}\u0000${diagnostic.line}\u0000${diagnostic.column}\u0000${diagnostic.plugin}\u0000${diagnostic.rule}\u0000${diagnostic.severity}\u0000${diagnostic.message}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    uniqueDiagnostics.push(diagnostic);
  }
  return uniqueDiagnostics;
};
