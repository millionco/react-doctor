import { REACT_DOCTOR_RULES } from "oxlint-plugin-react-doctor";
import { isSameRuleKey } from "@react-doctor/core";
import type { RuleSeverity } from "oxlint-plugin-react-doctor";

export interface RuleCatalogEntry {
  /** Fully-qualified rule key, e.g. `react-doctor/no-array-index-as-key`. */
  readonly key: string;
  /** Bare rule id without the plugin prefix, e.g. `no-array-index-as-key`. */
  readonly id: string;
  /** Display category, e.g. `Correctness`. */
  readonly category: string;
  /** Severity the rule registers with when no config override applies. */
  readonly defaultSeverity: RuleSeverity;
  /** Framework gate (`global` rules apply everywhere). */
  readonly framework: string;
  /** Behavioral tags (`design`, `test-noise`, …) consumed by `ignore.tags`. */
  readonly tags: ReadonlyArray<string>;
  /** Short fix guidance shown to users; mirrors the diagnostic `help`. */
  readonly recommendation: string | undefined;
  /** `false` for opt-in rules that only run when explicitly enabled. */
  readonly defaultEnabled: boolean;
}

export const buildRuleCatalog = (): RuleCatalogEntry[] =>
  REACT_DOCTOR_RULES.map((entry) => ({
    key: entry.key,
    id: entry.id,
    category: entry.rule.category ?? "Other",
    defaultSeverity: entry.rule.severity,
    framework: entry.rule.framework ?? "global",
    tags: entry.rule.tags ?? [],
    recommendation: entry.rule.recommendation,
    defaultEnabled: entry.rule.defaultEnabled !== false,
  }));

/**
 * Resolves a user-supplied rule reference to a catalog entry. Accepts the
 * fully-qualified key (`react-doctor/no-danger`), the bare id (`no-danger`),
 * and legacy plugin keys (`react/no-danger`) via the shared alias map.
 */
export const findRuleInCatalog = (
  catalog: ReadonlyArray<RuleCatalogEntry>,
  ruleQuery: string,
): RuleCatalogEntry | undefined => {
  const normalizedQuery = ruleQuery.trim();
  if (normalizedQuery.length === 0) return undefined;
  const directMatch = catalog.find(
    (entry) => entry.key === normalizedQuery || entry.id === normalizedQuery,
  );
  if (directMatch) return directMatch;
  return catalog.find((entry) => isSameRuleKey(entry.key, normalizedQuery));
};

export const listRuleCategories = (catalog: ReadonlyArray<RuleCatalogEntry>): string[] =>
  [...new Set(catalog.map((entry) => entry.category))].sort();

export const listRuleTags = (catalog: ReadonlyArray<RuleCatalogEntry>): string[] =>
  [...new Set(catalog.flatMap((entry) => [...entry.tags]))].sort();
