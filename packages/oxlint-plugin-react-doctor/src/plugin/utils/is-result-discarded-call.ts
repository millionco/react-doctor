import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// True when a CallExpression's return value is discarded. Covers plain
// statement position (`fn(x);`, `fn?.(x);`), the explicit discard operator
// (`void fn(x)`), discarded compound positions inside a statement — the
// guarded call `cond && fn(x);`, the branch of a statement ternary
// `cond ? fn(x) : noop();`, a sequence `(a(), fn(x));` — and a concise arrow
// body (`useEffect(() => fn(x), [x])`), whose implicit return no caller
// consumes. A call whose result flows into an argument, initializer, or
// right-hand side (`setError(fn(x))`, `const y = fn(x)`) is NOT discarded:
// its value is consumed locally, so it isn't a fire-and-forget side effect.
export const isResultDiscardedCall = (callExpression: EsTreeNode): boolean => {
  let node: EsTreeNode = callExpression;
  let parent: EsTreeNode | null | undefined = node.parent;
  while (parent) {
    if (isNodeOfType(parent, "ExpressionStatement")) return true;
    // `void fn(x)` always evaluates to undefined — the call result is
    // discarded no matter where the void expression itself flows.
    if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "void") return true;
    if (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === node) return true;
    if (isNodeOfType(parent, "ChainExpression")) {
      node = parent;
      parent = node.parent;
      continue;
    }
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === node) {
      node = parent;
      parent = node.parent;
      continue;
    }
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === node || parent.alternate === node)
    ) {
      node = parent;
      parent = node.parent;
      continue;
    }
    if (isNodeOfType(parent, "SequenceExpression")) {
      const expressions = parent.expressions ?? [];
      if (expressions[expressions.length - 1] !== node) return true;
      node = parent;
      parent = node.parent;
      continue;
    }
    return false;
  }
  return false;
};
