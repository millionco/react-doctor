import type { BasicBlock } from "../ir/basic-block.js";
import type { SimplePathResult } from "./enumerate-paths.js";
import { isPathFeasible } from "./feasibility.js";
import type { ResolveValueAtom } from "./path-condition.js";
import { pathConditionFacts } from "./path-condition.js";

// Decide whether a diagnostic witnessed by `result.paths` can be safely
// suppressed. This is the one place Layer D removes a false positive, and it
// is deliberately conservative: suppress ONLY when (a) the path search was
// complete (no cap tripped), (b) at least one path is a genuine
// counterexample, and (c) EVERY such counterexample is provably infeasible.
// Any `feasible`/`unknown` counterexample, or an incomplete search, leaves the
// diagnostic standing — so Layer D never hides a real bug.
export const everyCounterexampleInfeasible = (
  result: SimplePathResult,
  resolveValue: ResolveValueAtom,
  isCounterexample: (path: ReadonlyArray<BasicBlock>) => boolean = () => true,
): boolean => {
  if (!result.complete) return false;
  let foundCounterexample = false;
  for (const path of result.paths) {
    if (!isCounterexample(path)) continue;
    foundCounterexample = true;
    if (isPathFeasible(pathConditionFacts(path, resolveValue)) !== "infeasible") return false;
  }
  return foundCounterexample;
};
