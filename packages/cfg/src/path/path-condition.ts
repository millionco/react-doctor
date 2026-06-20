import type { EsTreeNode } from "../ast/es-tree-node.js";
import { isNodeOfType } from "../ast/is-node-of-type.js";
import type { BasicBlock } from "../ir/basic-block.js";
import type { Atom, PathFact } from "./literal-facts.js";
import { constAtomOf } from "./literal-facts.js";

// Maps a test-expression identifier to its abstract atom — the seam onto
// SSA: the caller keys the atom by `ssa.versionAt(node)` so the SAME value
// read at two branches lowers to the SAME atom (the crux of correlated-
// branch reasoning). Returns null for an unresolved / non-value operand.
export interface ResolveValueAtom {
  (identifier: EsTreeNode): Atom | null;
}

const lowerOperand = (node: EsTreeNode, resolveValue: ResolveValueAtom): Atom | null => {
  if (isNodeOfType(node, "Identifier")) return resolveValue(node);
  if (isNodeOfType(node, "Literal")) return constAtomOf(node.value);
  return null;
};

// Only STRICT equality lowers to an identity fact. Loose `==` / `!=` does not
// imply value identity (`[] == 0`, `1 == "1"`, `null == undefined` are all
// true across distinct/typed values), so treating it as `===` would let the
// checker "prove" a satisfiable path infeasible and suppress a real
// diagnostic. Dropping the fact is sound: fewer facts only make a path look
// MORE feasible, never less.
const STRICT_EQUALITY_OPERATORS = new Set(["===", "!=="]);

// Lower a branch test taken with the given truthiness into path facts. Only
// the shapes the checker understands are emitted; anything else yields no
// facts (so the guard is simply dropped — sound, since fewer facts can only
// make a path look MORE feasible, never less).
export const lowerGuard = (
  test: EsTreeNode,
  polarity: boolean,
  resolveValue: ResolveValueAtom,
): PathFact[] => {
  if (isNodeOfType(test, "UnaryExpression") && test.operator === "!") {
    return lowerGuard(test.argument as EsTreeNode, !polarity, resolveValue);
  }

  if (isNodeOfType(test, "LogicalExpression")) {
    // `a && b` taken true ⇒ both true; `a || b` taken false ⇒ both false.
    // The mixed cases are disjunctions a single conjunction can't capture.
    if (test.operator === "&&" && polarity) {
      return [
        ...lowerGuard(test.left as EsTreeNode, true, resolveValue),
        ...lowerGuard(test.right as EsTreeNode, true, resolveValue),
      ];
    }
    if (test.operator === "||" && !polarity) {
      return [
        ...lowerGuard(test.left as EsTreeNode, false, resolveValue),
        ...lowerGuard(test.right as EsTreeNode, false, resolveValue),
      ];
    }
    return [];
  }

  if (isNodeOfType(test, "BinaryExpression") && STRICT_EQUALITY_OPERATORS.has(test.operator)) {
    const left = lowerOperand(test.left as EsTreeNode, resolveValue);
    const right = lowerOperand(test.right as EsTreeNode, resolveValue);
    if (!left || !right) return [];
    return [
      { kind: "equality", left, right, polarity: test.operator === "===" ? polarity : !polarity },
    ];
  }

  if (isNodeOfType(test, "Identifier")) {
    const atom = resolveValue(test);
    return atom ? [{ kind: "truthy", atom, polarity }] : [];
  }

  return [];
};

// The conjunction of branch guards along a concrete block path: for each
// edge, the outcome the path took at the source block's branching terminal,
// lowered into facts over SSA values. Non-branching edges contribute
// nothing. Feeding the result to `isPathFeasible` decides whether the path
// can actually execute.
export const pathConditionFacts = (
  path: ReadonlyArray<BasicBlock>,
  resolveValue: ResolveValueAtom,
): PathFact[] => {
  const facts: PathFact[] = [];
  for (let index = 0; index + 1 < path.length; index++) {
    const from = path[index]!;
    const to = path[index + 1]!;
    const terminal = from.terminal;
    if (terminal.kind === "if") {
      if (to === terminal.consequent) facts.push(...lowerGuard(terminal.test, true, resolveValue));
      else if (to === terminal.alternate) {
        facts.push(...lowerGuard(terminal.test, false, resolveValue));
      }
      continue;
    }
    if ((terminal.kind === "while" || terminal.kind === "do-while") && terminal.test) {
      if (to === terminal.body) facts.push(...lowerGuard(terminal.test, true, resolveValue));
      else if (to === terminal.fallthrough) {
        facts.push(...lowerGuard(terminal.test, false, resolveValue));
      }
    }
  }
  return facts;
};
