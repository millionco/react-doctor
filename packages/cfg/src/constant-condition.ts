import type { EsTreeNode } from "./ast/es-tree-node.js";
import { isNodeOfType } from "./ast/is-node-of-type.js";

// Fold a condition expression to a compile-time boolean, or null when it
// is not a provable constant. Covers the cases oxc's `is_infinite_loop_start`
// folds: literals, the `Infinity` / `NaN` / `undefined` globals, a
// no-substitution template, and unary `!` / `void`.
//
// NOTE: like oxc's structural check but unlike a binding-resolving one, the
// `Infinity` / `NaN` / `undefined` arm matches by identifier name only. A
// shadowed global (`function f(Infinity) { while (Infinity) … }`) is a known
// false positive; it is pathological and matches the structural reference.
const evaluateConstantCondition = (test: EsTreeNode): boolean | null => {
  if (isNodeOfType(test, "Literal")) {
    const literalValue = test.value;
    if (typeof literalValue === "boolean") return literalValue;
    if (typeof literalValue === "number") return literalValue !== 0;
    if (typeof literalValue === "string") return literalValue.length > 0;
    if (typeof literalValue === "bigint") return literalValue !== BigInt(0);
    if (literalValue === null) return false;
    return null;
  }

  if (isNodeOfType(test, "Identifier")) {
    if (test.name === "Infinity") return true;
    if (test.name === "NaN" || test.name === "undefined") return false;
    return null;
  }

  if (isNodeOfType(test, "TemplateLiteral")) {
    if (test.expressions.length === 0 && test.quasis.length === 1) {
      return (test.quasis[0]!.value.cooked ?? "").length > 0;
    }
    return null;
  }

  if (isNodeOfType(test, "UnaryExpression")) {
    if (test.operator === "void") return false;
    if (test.operator === "!") {
      const folded = evaluateConstantCondition(test.argument as EsTreeNode);
      return folded === null ? null : !folded;
    }
  }

  return null;
};

// A loop whose test is a compile-time truthy constant (`while (true)`,
// `do … while (1)`) — or a `for (;;)` with no test at all — never exits
// through its condition. oxc's `is_infinite_loop_start` makes the same
// call to decide a loop's exit is unreachable; we use it both to omit the
// loop header→merge edge (so `while (true) {} after();` flags `after()` as
// unreachable) and to answer the public `isInfiniteLoopStart`.
export const isConstantTruthyTest = (test: EsTreeNode | null | undefined): boolean => {
  if (!test) return true;
  return evaluateConstantCondition(test) === true;
};
