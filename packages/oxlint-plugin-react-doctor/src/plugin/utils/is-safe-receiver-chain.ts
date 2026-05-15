import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isSafeReceiverChainNode } from "./is-safe-mutable-receiver-source.js";

// HACK: walks down `callee.object` / `argument` / `expression` looking
// for ANY ancestor in the receiver chain that is structurally "safe"
// (a Headers/Map/Set construction, a Response factory, a `.headers`
// access, a locally-scoped safe binding, etc.). Catching at any
// depth lets us cover `NextResponse.json({...}).headers.set(...)`,
// `(await someAsync()).headers.append(...)`, and parenthesized chains
// without a bunch of per-shape predicates.
export const isSafeReceiverChain = (
  receiverNode: EsTreeNode | null | undefined,
  locallyScopedSafeBindings: Set<string>,
): boolean => {
  let current: EsTreeNode | null | undefined = receiverNode;
  while (current) {
    if (isSafeReceiverChainNode(current, locallyScopedSafeBindings)) return true;
    if (isNodeOfType(current, "MemberExpression")) {
      current = current.object;
      continue;
    }
    if (isNodeOfType(current, "ChainExpression")) {
      current = current.expression;
      continue;
    }
    if (isNodeOfType(current, "AwaitExpression")) {
      current = current.argument;
      continue;
    }
    if (isNodeOfType(current, "TSNonNullExpression") || isNodeOfType(current, "TSAsExpression")) {
      current = current.expression;
      continue;
    }
    return false;
  }
  return false;
};
