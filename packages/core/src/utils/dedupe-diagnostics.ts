import type { Diagnostic } from "../types/index.js";

const DERIVED_STATE_RULE_PRIORITY: ReadonlyMap<string, number> = new Map([
  ["no-initialize-state", 0],
  ["no-adjust-state-on-prop-change", 1],
  ["no-derived-state", 2],
  ["no-derived-state-effect", 3],
]);

const doDiagnosticSpansOverlap = (first: Diagnostic, second: Diagnostic): boolean => {
  if (first.filePath !== second.filePath || first.plugin !== second.plugin) return false;
  if (first.offset !== undefined && second.offset !== undefined) {
    const firstEnd = first.offset + Math.max(first.length ?? 1, 1);
    const secondEnd = second.offset + Math.max(second.length ?? 1, 1);
    return first.offset < secondEnd && second.offset < firstEnd;
  }
  const firstEndLine = first.endLine ?? first.line;
  const secondEndLine = second.endLine ?? second.line;
  return first.line <= secondEndLine && second.line <= firstEndLine;
};

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
    const priority = DERIVED_STATE_RULE_PRIORITY.get(diagnostic.rule);
    if (priority !== undefined) {
      const overlappingDiagnosticIndex = uniqueDiagnostics.findIndex(
        (candidate) =>
          candidate.rule !== diagnostic.rule &&
          candidate.severity === diagnostic.severity &&
          DERIVED_STATE_RULE_PRIORITY.has(candidate.rule) &&
          doDiagnosticSpansOverlap(candidate, diagnostic),
      );
      if (overlappingDiagnosticIndex >= 0) {
        const existingDiagnostic = uniqueDiagnostics[overlappingDiagnosticIndex];
        const existingPriority = existingDiagnostic
          ? DERIVED_STATE_RULE_PRIORITY.get(existingDiagnostic.rule)
          : undefined;
        if (existingPriority !== undefined && priority < existingPriority) {
          uniqueDiagnostics[overlappingDiagnosticIndex] = diagnostic;
        }
        continue;
      }
    }
    uniqueDiagnostics.push(diagnostic);
  }
  return uniqueDiagnostics;
};
