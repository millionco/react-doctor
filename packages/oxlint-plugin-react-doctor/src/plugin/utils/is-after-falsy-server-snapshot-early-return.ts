import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { executesDuringRender } from "./executes-during-render.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { readServerSnapshotBoolean } from "./read-server-snapshot-boolean.js";

export const isAfterFalsyServerSnapshotEarlyReturn = (
  node: EsTreeNode,
  componentOrHookNode: EsTreeNode,
  scopes: ScopeAnalysis,
  filename?: string,
): boolean => {
  const enclosingFunction = findEnclosingFunction(node);
  if (
    !enclosingFunction ||
    (enclosingFunction !== componentOrHookNode &&
      !executesDuringRender(enclosingFunction, scopes)) ||
    !isFunctionLike(enclosingFunction) ||
    !isNodeOfType(enclosingFunction.body, "BlockStatement")
  ) {
    return false;
  }
  let currentNode: EsTreeNode = node;
  while (currentNode !== enclosingFunction) {
    const parentNode = currentNode.parent;
    if (!parentNode) return false;
    if (isNodeOfType(parentNode, "BlockStatement")) {
      for (const statement of parentNode.body) {
        if (statement === currentNode) break;
        if (!isNodeOfType(statement, "IfStatement")) continue;
        const serverResult = readServerSnapshotBoolean(statement.test, scopes, filename);
        let serverBranch: EsTreeNode | null = null;
        if (serverResult === true) serverBranch = statement.consequent;
        else if (serverResult === false) serverBranch = statement.alternate;
        if (isNodeOfType(serverBranch, "BlockStatement")) {
          const [firstStatement, ...additionalStatements] = serverBranch.body;
          if (additionalStatements.length) continue;
          serverBranch = firstStatement ?? null;
        }
        if (isNodeOfType(serverBranch, "ReturnStatement")) return true;
      }
    }
    currentNode = parentNode;
  }
  return false;
};
