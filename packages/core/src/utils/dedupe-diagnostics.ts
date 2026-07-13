import type { Diagnostic } from "../types/index.js";

// HACK: oxlint plugin rules occasionally emit the same diagnostic
// twice. This safety net collapses exact duplicates before cache storage
// and replay. Cross-rule deduplication happens after the diagnostic
// pipeline so independently suppressed rules cannot erase one another.
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
