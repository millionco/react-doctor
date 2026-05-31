export type RuleTier = "P0" | "P1" | "P2" | "P3";

export interface RulePriority {
  // Intrinsic end-user value of the rule, 0-100, or null when the rule isn't
  // ranked yet. Higher = more worth fixing first.
  readonly priority: number | null;
  readonly tier: RuleTier;
}

export interface ScoreResult {
  score: number;
  label: string;
  // Per-rule priority returned by the score API, keyed by `<plugin>/<rule>`.
  // Present when the score API ranks the violated rules; used to order the
  // diagnostics dump most-valuable-first. Absent under `--no-score` or when the
  // API is unreachable, in which case rendering falls back to severity order.
  readonly rules?: Readonly<Record<string, RulePriority>>;
}
