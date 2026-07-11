import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { readStaticBoolean } from "../../../utils/read-static-boolean.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";

const PATH_AMBIGUOUS_ANCESTOR_TYPES: ReadonlySet<string> = new Set([
  "CatchClause",
  "ConditionalExpression",
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "IfStatement",
  "LogicalExpression",
  "SwitchCase",
  "SwitchStatement",
  "TryStatement",
  "WhileStatement",
]);

const isGuaranteedChild = (parentNode: EsTreeNode, childNode: EsTreeNode): boolean => {
  if (isNodeOfType(parentNode, "IfStatement")) {
    if (parentNode.test === childNode) return true;
    const staticTestValue = readStaticBoolean(parentNode.test);
    return (
      (parentNode.consequent === childNode && staticTestValue === true) ||
      (parentNode.alternate === childNode && staticTestValue === false)
    );
  }
  if (isNodeOfType(parentNode, "ConditionalExpression")) {
    if (parentNode.test === childNode) return true;
    const staticTestValue = readStaticBoolean(parentNode.test);
    return (
      (parentNode.consequent === childNode && staticTestValue === true) ||
      (parentNode.alternate === childNode && staticTestValue === false)
    );
  }
  if (isNodeOfType(parentNode, "LogicalExpression")) {
    if (parentNode.left === childNode) return true;
    if (parentNode.right !== childNode) return false;
    const staticLeftValue = readStaticBoolean(parentNode.left);
    return (
      (parentNode.operator === "&&" && staticLeftValue === true) ||
      (parentNode.operator === "||" && staticLeftValue === false)
    );
  }
  if (isNodeOfType(parentNode, "TryStatement")) {
    return parentNode.finalizer === childNode;
  }
  if (isNodeOfType(parentNode, "SwitchStatement")) {
    return parentNode.discriminant === childNode;
  }
  if (isNodeOfType(parentNode, "ForStatement")) {
    return parentNode.init === childNode || parentNode.test === childNode;
  }
  if (isNodeOfType(parentNode, "ForInStatement") || isNodeOfType(parentNode, "ForOfStatement")) {
    return parentNode.right === childNode;
  }
  if (isNodeOfType(parentNode, "WhileStatement")) {
    return parentNode.test === childNode;
  }
  return false;
};

export const isListenerPathAmbiguous = (
  node: EsTreeNode,
  bodyNode: EsTreeNode,
  allowAmbiguousChild?: (parentNode: EsTreeNode, childNode: EsTreeNode) => boolean,
): boolean => {
  let currentNode: EsTreeNode | null | undefined = node;
  while (currentNode && currentNode !== bodyNode) {
    const parentNode: EsTreeNode | null | undefined = currentNode.parent;
    if (!parentNode) return true;
    if (
      PATH_AMBIGUOUS_ANCESTOR_TYPES.has(parentNode.type) &&
      !isGuaranteedChild(parentNode, currentNode) &&
      !allowAmbiguousChild?.(parentNode, currentNode)
    ) {
      return true;
    }
    currentNode = parentNode;
  }
  return false;
};
