import { buildRuleDocsUrl, groupBy, hasPublishedFixRecipe } from "@react-doctor/core";
import type { Diagnostic, ScoreResult } from "@react-doctor/core";

// Ordering / formatting helpers shared by the diagnostics renderer, the
// agent-handoff payload builder, and the on-disk diagnostics writer — so
// every surface ranks and references rules the same way without one
// reaching into the renderer for them.
//
// Ranking depends solely on the score API's per-rule priority. Rules the
// API didn't rank — and every rule when the score is unavailable
// (`--no-score`, offline, API failure) — carry no priority and keep their
// original (scan) order via the stable sort. There is no hand-rolled
// severity / category-stakes weighting.

// Build a `<plugin>/<rule>` -> priority lookup from the score API's per-rule
// payload (merged across scans). Rules the API didn't rank — or every rule
// when the score is unavailable — are simply absent.
export const buildRulePriorityMap = (
  scores: ReadonlyArray<ScoreResult | null>,
): ReadonlyMap<string, number> => {
  const rulePriority = new Map<string, number>();
  for (const score of scores) {
    if (!score?.rules) continue;
    for (const [ruleKey, info] of Object.entries(score.rules)) {
      if (typeof info.priority === "number") rulePriority.set(ruleKey, info.priority);
    }
  }
  return rulePriority;
};

// API priority is the only ranking signal: higher priority sorts first.
// A rule the API didn't rank sorts after a ranked one; two unranked rules
// (or every rule when the score is unavailable) compare equal and keep
// their original order via `toSorted`'s stability.
export const compareByRulePriority = (
  ruleKeyA: string,
  ruleKeyB: string,
  rulePriority: ReadonlyMap<string, number> | undefined,
): number => {
  const priorityA = rulePriority?.get(ruleKeyA);
  const priorityB = rulePriority?.get(ruleKeyB);
  if (priorityA === undefined && priorityB === undefined) return 0;
  if (priorityA === undefined) return 1;
  if (priorityB === undefined) return -1;
  return priorityB - priorityA;
};

const sortRuleGroupsByImportance = (
  diagnosticGroups: [string, Diagnostic[]][],
  rulePriority?: ReadonlyMap<string, number>,
): [string, Diagnostic[]][] =>
  diagnosticGroups.toSorted(([ruleKeyA], [ruleKeyB]) =>
    compareByRulePriority(ruleKeyA, ruleKeyB, rulePriority),
  );

// Buckets diagnostics into `<plugin>/<rule>` groups, then ranks them by the
// score API's per-rule priority (stable scan order when unranked). The
// single grouping+ranking primitive every rule-list surface builds on — the
// category breakdown, the top-errors block, the warnings roll-up, the
// verbose per-rule detail, the agent handoff, and the on-disk dump — so they
// all bucket and order rules identically.
export const buildSortedRuleGroups = (
  diagnostics: ReadonlyArray<Diagnostic>,
  rulePriority?: ReadonlyMap<string, number>,
): [string, Diagnostic[]][] =>
  sortRuleGroupsByImportance(
    [...groupBy([...diagnostics], (diagnostic) => `${diagnostic.plugin}/${diagnostic.rule}`)],
    rulePriority,
  );

// Agent-facing directive (not a bare label) so a consuming agent treats the
// URL as a step to perform — cache-bust the canonical, reviewer-tested
// recipe, then follow both its fix and its false-positive check before
// editing — rather than as optional reference docs it can skip. Humans get
// the shorter `formatLearnMoreLine` instead.
const FIX_RECIPE_DIRECTIVE_LABEL =
  "Curl with no cache & follow the canonical fix and false positive check recipe before fixing";

// `null` when the rule has no published recipe (dead-code, environment
// checks, adopted plugins) so callers omit the directive instead of
// linking to a 404.
export const formatFixRecipeLine = (diagnostic: Diagnostic): string | null =>
  hasPublishedFixRecipe(diagnostic)
    ? `${FIX_RECIPE_DIRECTIVE_LABEL}: ${buildRuleDocsUrl(diagnostic.plugin, diagnostic.rule)}`
    : null;

// Human-facing variant: a short, prominent pointer to the rule's docs page.
// Same `null` gating as `formatFixRecipeLine`.
export const formatLearnMoreLine = (diagnostic: Diagnostic): string | null =>
  hasPublishedFixRecipe(diagnostic)
    ? `Learn more: ${buildRuleDocsUrl(diagnostic.plugin, diagnostic.rule)}`
    : null;
