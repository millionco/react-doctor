import { canNodeReachLaterNodeWithinFunction } from "./can-node-reach-later-node-within-function.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { nodeDominatesNode } from "./node-dominates-node.js";
import type { RuleContext } from "./rule-context.js";
import { walkOwnFunctionScope } from "./walk-own-function-scope.js";

export const getUninterruptedConstInitializer = (
  reference: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  if (!isNodeOfType(reference, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(reference);
  const initializer = symbol ? getDirectConstInitializer(symbol) : null;
  const owner = context.cfg.enclosingFunction(reference);
  if (!initializer || !owner || !nodeDominatesNode(initializer, reference, context)) return null;
  let hasInterveningSuspension = false;
  walkOwnFunctionScope(owner, (candidate) => {
    if (hasInterveningSuspension) return false;
    if (
      (isNodeOfType(candidate, "AwaitExpression") ||
        (isNodeOfType(candidate, "ForOfStatement") && candidate.await)) &&
      canNodeReachLaterNodeWithinFunction(initializer, candidate, owner, context) &&
      canNodeReachLaterNodeWithinFunction(candidate, reference, owner, context)
    ) {
      hasInterveningSuspension = true;
      return false;
    }
  });
  return hasInterveningSuspension ? null : initializer;
};
