import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isEarlyExitStatement } from "../../../utils/is-early-exit-statement.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { forEachChildNode, walkAst } from "../../../utils/walk-ast.js";
import { ASYNC_WHILE_UNSUPPORTED_CONTROL_TYPES } from "./constants.js";

interface AsyncWhileFlowCheckerInput {
  readonly isStateSetterCall: (node: EsTreeNodeOfType<"CallExpression">) => boolean;
}

export interface AsyncWhileFlowChecker {
  (statement: EsTreeNodeOfType<"WhileStatement">): boolean;
}

interface AsyncWhileNodeFacts {
  readonly hasAsyncEvent: boolean;
  readonly hasUnsupportedControl: boolean;
}

export const createAsyncWhileFlowChecker = ({
  isStateSetterCall,
}: AsyncWhileFlowCheckerInput): AsyncWhileFlowChecker => {
  const supportedByStatement = new WeakMap<EsTreeNode, boolean>();
  return (statement) => {
    const cachedSupport = supportedByStatement.get(statement);
    if (cachedSupport !== undefined) return cachedSupport;
    let ancestor = statement.parent;
    while (ancestor && !isFunctionLike(ancestor)) {
      if (isNodeOfType(ancestor, "TryStatement")) {
        supportedByStatement.set(statement, false);
        return false;
      }
      ancestor = ancestor.parent;
    }
    const subtreeNodes: EsTreeNode[] = [];
    walkAst(statement, (node) => {
      subtreeNodes.push(node);
      if (
        isFunctionLike(node) ||
        ASYNC_WHILE_UNSUPPORTED_CONTROL_TYPES.has(node.type) ||
        (isNodeOfType(node, "ReturnStatement") && node.argument)
      )
        return false;
    });
    const factsByNode = new WeakMap<EsTreeNode, AsyncWhileNodeFacts>();
    for (let nodeIndex = subtreeNodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
      const node = subtreeNodes[nodeIndex];
      if (!node) continue;
      if (isFunctionLike(node)) {
        factsByNode.set(node, { hasAsyncEvent: false, hasUnsupportedControl: false });
        continue;
      }
      let hasAsyncEvent =
        isNodeOfType(node, "AwaitExpression") ||
        (isNodeOfType(node, "ForOfStatement") && node.await) ||
        (isNodeOfType(node, "CallExpression") && isStateSetterCall(node));
      let hasUnsupportedControl =
        ASYNC_WHILE_UNSUPPORTED_CONTROL_TYPES.has(node.type) ||
        (isNodeOfType(node, "ReturnStatement") && Boolean(node.argument));
      forEachChildNode(node, (child) => {
        const childFacts = factsByNode.get(child);
        if (childFacts?.hasAsyncEvent) hasAsyncEvent = true;
        if (childFacts?.hasUnsupportedControl) hasUnsupportedControl = true;
      });
      if (
        isNodeOfType(node, "IfStatement") &&
        !node.alternate &&
        isEarlyExitStatement(node.consequent) &&
        factsByNode.get(node.consequent)?.hasAsyncEvent
      )
        hasUnsupportedControl = true;
      factsByNode.set(node, { hasAsyncEvent, hasUnsupportedControl });
      if (isNodeOfType(node, "WhileStatement"))
        supportedByStatement.set(node, !hasUnsupportedControl);
    }
    return supportedByStatement.get(statement) ?? false;
  };
};
