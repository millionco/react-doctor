import type { Diagnostic } from "../types/index.js";

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

// Total, content-stable order on the SAME 7-field identity tuple
// `dedupeDiagnostics` keys on (filePath, line, column, plugin, rule, severity,
// message) — including `severity`, so two diagnostics that collide on
// site/rule/message but differ in severity still order deterministically.
// After dedupe there is at most one diagnostic per tuple, so this never ties:
// the order is total. Makes `finalDiagnostics` — and therefore the JSON
// report, the CLI render, the on-disk dump, the agent handoff, the Sentry wide
// event, and the scan-result cache payload — reproducible run-to-run,
// independent of the (parallel, now cost-reordered) lint arrival order.
export const sortDiagnosticsStable = (diagnostics: ReadonlyArray<Diagnostic>): Diagnostic[] =>
  [...diagnostics].sort(
    (left, right) =>
      compareStrings(left.filePath, right.filePath) ||
      left.line - right.line ||
      left.column - right.column ||
      compareStrings(left.plugin, right.plugin) ||
      compareStrings(left.rule, right.rule) ||
      compareStrings(left.severity, right.severity) ||
      compareStrings(left.message, right.message),
  );
