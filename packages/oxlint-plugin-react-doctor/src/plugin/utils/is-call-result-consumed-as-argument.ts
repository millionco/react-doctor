import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// True when a CallExpression's return value flows into the argument slot of
// another call (`setDisplay(format(amount))`, `setError(validate(value))`) —
// the callee is a pure transform whose result is consumed locally, not a
// fire-and-forget hand-back. Anything else counts as a hand-back: statement
// position (`onSync(x);`), a guarded call (`onSync && onSync(x)`), a concise
// arrow body (`() => onSync(x)`), and even an initializer or condition — the
// parent may consume the value, but the call still pushes live state into it.
export const isCallResultConsumedAsArgument = (callExpression: EsTreeNode): boolean => {
  let node: EsTreeNode = callExpression;
  let parent: EsTreeNode | null | undefined = node.parent;
  if (parent && isNodeOfType(parent, "ChainExpression")) {
    node = parent;
    parent = node.parent;
  }
  if (!parent) return false;
  if (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) {
    return (parent.arguments ?? []).some((argument) => argument === node);
  }
  return false;
};
