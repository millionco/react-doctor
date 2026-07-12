import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { readInitialStateBoolean } from "./read-initial-state-boolean.js";
import { statementAlwaysExits } from "./statement-always-exits.js";
import type { EsTreeNode } from "./es-tree-node.js";

export const isAfterClientOnlyEarlyReturn = (
  node: EsTreeNode,
  componentOrHookNode: EsTreeNode,
  scopes: ScopeAnalysis,
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
    const initialConditionResult = readInitialStateBoolean(statement.test, scopes);
    if (initialConditionResult === true && statementAlwaysExits(statement.consequent)) return true;
    if (
      initialConditionResult === false &&
      statement.alternate &&
      statementAlwaysExits(statement.alternate)
    ) {
      return true;
    }
  }
  return false;
};
