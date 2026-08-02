import { buildRuleDocsUrl, hasPublishedFixRecipe } from "@react-doctor/core";
import type { Diagnostic, ScoreResult } from "@react-doctor/core";
import { buildRulePriorityMap, buildSortedRuleGroups } from "../../utils/diagnostic-grouping.js";
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
  readonly ruleGuideUrl: string | null;
}

export const buildDiagnosticRows = (
  diagnostics: ReadonlyArray<Diagnostic>,
  scores: ReadonlyArray<ScoreResult | null>,
): DiagnosticRow[] => {
  const rulePriority = buildRulePriorityMap(scores);
  return buildSortedRuleGroups(diagnostics, rulePriority).map(([ruleKey, ruleDiagnostics]) => {
    const representative =
      ruleDiagnostics.find((diagnostic) => diagnostic.line > 0) ?? ruleDiagnostics[0];
    return {
      ruleKey,
      diagnostics: ruleDiagnostics,
      severity: representative.severity === "error" ? "error" : "warning",
      category: representative.category,
      title: representative.title ?? ruleKey,
      location: formatDiagnosticSite(representative),
      siteCount: ruleDiagnostics.length,
      representative,
      ruleGuideUrl: hasPublishedFixRecipe(representative)
        ? buildRuleDocsUrl(representative.plugin, representative.rule)
        : null,
    };
  });
};
