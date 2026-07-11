import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { referencesClientOnlyFlag } from "./references-client-only-flag.js";
import { referencesFalsyInitialState } from "./references-falsy-initial-state.js";
import { walkAst } from "./walk-ast.js";
import type { EsTreeNode } from "./es-tree-node.js";

export const isAfterClientOnlyEarlyReturn = (
  node: EsTreeNode,
  componentOrHookNode: EsTreeNode,
): boolean => {
  const body = isFunctionLike(componentOrHookNode) ? componentOrHookNode.body : null;
  if (!isNodeOfType(body, "BlockStatement")) return false;
  const ancestors = new Set<EsTreeNode>();
  let currentNode: EsTreeNode | null | undefined = node;
  while (currentNode) {
    ancestors.add(currentNode);
    currentNode = currentNode.parent ?? null;
  }
  for (const statement of body.body ?? []) {
    if (ancestors.has(statement)) return false;
    if (!isNodeOfType(statement, "IfStatement")) continue;
    if (!referencesClientOnlyFlag(statement.test) && !referencesFalsyInitialState(statement.test)) {
      continue;
    }
    let returnsEarly = false;
    walkAst(statement.consequent, (child: EsTreeNode) => {
      if (isFunctionLike(child)) return false;
      if (isNodeOfType(child, "ReturnStatement")) {
        returnsEarly = true;
        return false;
      }
    });
    if (returnsEarly) return true;
  }
  return false;
};
