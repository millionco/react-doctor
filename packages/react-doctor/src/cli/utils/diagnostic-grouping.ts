import {
  buildRuleDocsUrl,
  groupBy,
  hasPublishedFixRecipe,
  MIGRATION_SCALE_RULE_FILE_COUNT,
  MIN_SHARED_FIX_SITE_COUNT,
} from "@react-doctor/core";
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

// When every finding in a group shares one root-cause fix (the `fixGroupId`
// the core layer stamps on same-(file, rule, message) sites), the number of
// findings that single fix resolves — else 0 (the group spans several fixes,
// or none carry an id). Lets a surface say "one fix · N sites" instead of
// "N findings", so one keyed-state fix reads as one task, not N.
export const getSharedFixSiteCount = (diagnostics: ReadonlyArray<Diagnostic>): number => {
  if (diagnostics.length < MIN_SHARED_FIX_SITE_COUNT) return 0;
  const firstFixGroupId = diagnostics[0]?.fixGroupId;
  if (!firstFixGroupId) return 0;
  const sharesOneFix = diagnostics.every((diagnostic) => diagnostic.fixGroupId === firstFixGroupId);
  return sharesOneFix ? diagnostics.length : 0;
};

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

// Per-rule "blast radius": how many sites a `<plugin>/<rule>` group reports and
// how many distinct files those sites span. Files (not raw sites) measure the
// review burden of fixing a rule everywhere — 800 sites in 2 files is a small
// PR; 800 across 300 files is a migration — so this is what the migration-scale
// advisory and its calibration metric both read. Sorted widest blast radius
// first; the title falls back to the rule key for adopted third-party rules.
export interface RuleBlastRadius {
  readonly ruleKey: string;
  readonly title: string;
  readonly siteCount: number;
  readonly fileCount: number;
}

export const buildRuleBlastRadii = (diagnostics: ReadonlyArray<Diagnostic>): RuleBlastRadius[] =>
  buildSortedRuleGroups(diagnostics)
    .map(([ruleKey, ruleDiagnostics]) => ({
      ruleKey,
      title: ruleDiagnostics[0]!.title ?? ruleKey,
      siteCount: ruleDiagnostics.length,
      fileCount: new Set(ruleDiagnostics.map((diagnostic) => diagnostic.filePath)).size,
    }))
    .toSorted((left, right) => right.fileCount - left.fileCount);

// The rule groups whose fix would touch enough files to be a migration rather
// than a quick fix — the set that warrants sampling a few sites, confirming the
// recipe holds, and getting the code owner's sign-off before sweeping the rest.
export const findMigrationScaleBuckets = (
  diagnostics: ReadonlyArray<Diagnostic>,
): RuleBlastRadius[] =>
  buildRuleBlastRadii(diagnostics).filter(
    (bucket) => bucket.fileCount >= MIGRATION_SCALE_RULE_FILE_COUNT,
  );
