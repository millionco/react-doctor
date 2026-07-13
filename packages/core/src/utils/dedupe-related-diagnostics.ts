import type { Diagnostic } from "../types/index.js";

const DERIVED_STATE_RULE_PRIORITY: ReadonlyMap<string, number> = new Map([
  ["no-initialize-state", 0],
  ["no-adjust-state-on-prop-change", 1],
  ["no-derived-state", 2],
  ["no-derived-state-effect", 3],
]);

const buildDiagnosticSiteKey = (diagnostic: Diagnostic): string =>
  `${diagnostic.filePath}\u0000${diagnostic.line}\u0000${diagnostic.column}`;

const isReactDoctorRulesOfHooksDiagnostic = (diagnostic: Diagnostic): boolean =>
  diagnostic.plugin === "react-doctor" && diagnostic.rule === "rules-of-hooks";

const isReactCompilerHooksDiagnostic = (diagnostic: Diagnostic): boolean =>
  diagnostic.plugin === "react-hooks-js" && diagnostic.rule === "hooks";

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

const keepHighestSeverity = (
  survivingDiagnostic: Diagnostic,
  collapsedDiagnostic: Diagnostic,
): Diagnostic =>
  collapsedDiagnostic.severity === "error" && survivingDiagnostic.severity !== "error"
    ? { ...survivingDiagnostic, severity: "error" }
    : survivingDiagnostic;

export const dedupeRelatedDiagnostics = (diagnostics: ReadonlyArray<Diagnostic>): Diagnostic[] => {
  const reactDoctorHookSites = new Set(
    diagnostics.filter(isReactDoctorRulesOfHooksDiagnostic).map(buildDiagnosticSiteKey),
  );
  const uniqueDiagnostics: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    if (
      isReactCompilerHooksDiagnostic(diagnostic) &&
      reactDoctorHookSites.has(buildDiagnosticSiteKey(diagnostic))
    ) {
      continue;
    }
    const priority = DERIVED_STATE_RULE_PRIORITY.get(diagnostic.rule);
    if (priority !== undefined) {
      const overlappingDiagnosticIndex = uniqueDiagnostics.findIndex(
        (candidate) =>
          candidate.rule !== diagnostic.rule &&
          DERIVED_STATE_RULE_PRIORITY.has(candidate.rule) &&
          doDiagnosticSpansOverlap(candidate, diagnostic),
      );
      if (overlappingDiagnosticIndex >= 0) {
        const existingDiagnostic = uniqueDiagnostics[overlappingDiagnosticIndex];
        const existingPriority = existingDiagnostic
          ? DERIVED_STATE_RULE_PRIORITY.get(existingDiagnostic.rule)
          : undefined;
        if (existingDiagnostic && existingPriority !== undefined) {
          uniqueDiagnostics[overlappingDiagnosticIndex] =
            priority < existingPriority
              ? keepHighestSeverity(diagnostic, existingDiagnostic)
              : keepHighestSeverity(existingDiagnostic, diagnostic);
        }
        continue;
      }
    }
    uniqueDiagnostics.push(diagnostic);
  }
  return uniqueDiagnostics;
};
