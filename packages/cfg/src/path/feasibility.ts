import { MAX_PATH_CLAUSES, MAX_PATH_VARS } from "../constants.js";
import type { Atom, PathFact } from "./literal-facts.js";
import { atomKey, createUnionFind } from "./literal-facts.js";

// `infeasible` — the conjunction of facts is provably contradictory (no
// runtime state satisfies them), so a counterexample path carrying them is a
// false positive. `feasible` — no contradiction detected. `unknown` — caps
// exceeded. ONLY `infeasible` may suppress a diagnostic; `feasible` and
// `unknown` leave behavior unchanged, so the checker is never unsound for
// bug-finding.
export type Feasibility = "feasible" | "infeasible" | "unknown";

interface ClassFacts {
  // The constant value keys equated into this class (`x === 1` → "n:1").
  readonly constKeys: Set<string>;
  // Truthiness requirements placed on the class (`if (x)` → true).
  readonly requiredTruthiness: Set<boolean>;
  // Truthiness of any constant in the class (a literal is its own truth).
  readonly constTruthiness: Set<boolean>;
}

const classFactsOf = (byRoot: Map<string, ClassFacts>, root: string): ClassFacts => {
  let facts = byRoot.get(root);
  if (!facts) {
    facts = { constKeys: new Set(), requiredTruthiness: new Set(), constTruthiness: new Set() };
    byRoot.set(root, facts);
  }
  return facts;
};

// A bounded consistency check over a single path's conjunction of facts: a
// union-find congruence closure for equalities, plus truthiness and
// disequality constraints layered on the resulting classes. A path condition
// is a pure conjunction (one branch outcome per edge), so no boolean search
// is needed — only contradiction detection. Returns `infeasible` only on a
// proof; `unknown` when the caps trip.
export const isPathFeasible = (facts: ReadonlyArray<PathFact>): Feasibility => {
  if (facts.length > MAX_PATH_CLAUSES) return "unknown";

  const atoms = new Set<string>();
  for (const fact of facts) {
    if (fact.kind === "truthy") atoms.add(atomKey(fact.atom));
    else {
      atoms.add(atomKey(fact.left));
      atoms.add(atomKey(fact.right));
    }
  }
  if (atoms.size > MAX_PATH_VARS) return "unknown";

  const unionFind = createUnionFind();
  const disequalities: Array<[string, string]> = [];
  const constTruthByKey = new Map<string, boolean>();
  const truthyConstraints: Array<{ key: string; polarity: boolean }> = [];

  const noteConst = (atom: Atom): void => {
    if (atom.kind === "const") constTruthByKey.set(atomKey(atom), atom.truthy);
  };

  for (const fact of facts) {
    if (fact.kind === "truthy") {
      noteConst(fact.atom);
      truthyConstraints.push({ key: atomKey(fact.atom), polarity: fact.polarity });
      continue;
    }
    noteConst(fact.left);
    noteConst(fact.right);
    const leftKey = atomKey(fact.left);
    const rightKey = atomKey(fact.right);
    if (fact.polarity) unionFind.union(leftKey, rightKey);
    else disequalities.push([leftKey, rightKey]);
  }

  // Aggregate per equality class.
  const byRoot = new Map<string, ClassFacts>();
  for (const [key, truthy] of constTruthByKey) {
    const facts = classFactsOf(byRoot, unionFind.find(key));
    facts.constKeys.add(key);
    facts.constTruthiness.add(truthy);
  }
  for (const constraint of truthyConstraints) {
    classFactsOf(byRoot, unionFind.find(constraint.key)).requiredTruthiness.add(
      constraint.polarity,
    );
  }

  for (const classFacts of byRoot.values()) {
    // Two distinct constants equated: `x === 1 && x === 2`.
    if (classFacts.constKeys.size > 1) return "infeasible";
    // A value required both truthy and falsy: `if (x) … if (!x)` on one path.
    if (classFacts.requiredTruthiness.size > 1) return "infeasible";
    // A constant whose truthiness contradicts the requirement: `x === 0` on a
    // path that also needs `x` truthy.
    const allTruthiness = new Set([
      ...classFacts.constTruthiness,
      ...classFacts.requiredTruthiness,
    ]);
    if (allTruthiness.size > 1) return "infeasible";
  }

  // `x !== y` while `x === y` was also asserted.
  for (const [left, right] of disequalities) {
    if (unionFind.find(left) === unionFind.find(right)) return "infeasible";
  }

  return "feasible";
};
