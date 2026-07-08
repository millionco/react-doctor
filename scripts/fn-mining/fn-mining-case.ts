export interface FnMiningCase {
  ruleId: string;
  description: string;
  filePath: string;
  code: string;
  // false marks a deliberate carve-out: the rule intentionally stays
  // silent on this shape (precision gate / documented scoping). Such
  // cases must explain themselves via `carveOutReason` and are not
  // reported as FN candidates.
  shouldFire: boolean;
  carveOutReason?: string;
}
