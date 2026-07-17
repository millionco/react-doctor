import type { Diagnostic, ScoreResult } from "@react-doctor/core";
import {
  buildRulePriorityMap,
  buildSortedRuleGroups,
  formatLearnMoreLine,
} from "../../utils/diagnostic-grouping.js";
import { formatDiagnosticSite } from "../../utils/format-diagnostic-site.js";
import type { Severity } from "./severity-variants.js";

export interface DiagnosticRow {
  readonly ruleKey: string;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly severity: Severity;
  readonly category: string;
  readonly title: string;
  readonly location: string;
  readonly siteCount: number;
  readonly representative: Diagnostic;
  readonly learnMore: string | null;
}

const pickRepresentative = (diagnostics: ReadonlyArray<Diagnostic>): Diagnostic =>
  diagnostics.find((diagnostic) => diagnostic.line > 0) ?? diagnostics[0];

export const buildDiagnosticRows = (
  diagnostics: ReadonlyArray<Diagnostic>,
  scores: ReadonlyArray<ScoreResult | null>,
): DiagnosticRow[] => {
  const rulePriority = buildRulePriorityMap(scores);
  return buildSortedRuleGroups(diagnostics, rulePriority).map(([ruleKey, ruleDiagnostics]) => {
    const representative = pickRepresentative(ruleDiagnostics);
    return {
      ruleKey,
      diagnostics: ruleDiagnostics,
      severity: representative.severity === "error" ? "error" : "warning",
      category: representative.category,
      title: representative.title ?? ruleKey,
      location: formatDiagnosticSite(representative),
      siteCount: ruleDiagnostics.length,
      representative,
      learnMore: formatLearnMoreLine(representative),
    };
  });
};
