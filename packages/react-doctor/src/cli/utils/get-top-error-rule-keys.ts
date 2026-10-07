import type { Diagnostic } from "@react-doctor/core";
import { buildSortedRuleGroups } from "./diagnostic-grouping.js";

export const getTopErrorRuleKeys = (
  diagnostics: ReadonlyArray<Diagnostic>,
  limit: number,
  rulePriority?: ReadonlyMap<string, number>,
): ReadonlySet<string> =>
  new Set(
    buildSortedRuleGroups(
      diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
      rulePriority,
    )
      .slice(0, limit)
      .map(([ruleKey]) => ruleKey),
  );
