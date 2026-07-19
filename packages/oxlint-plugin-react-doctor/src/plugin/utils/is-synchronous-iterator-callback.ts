import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const SYNCHRONOUS_ITERATOR_METHOD_NAMES: ReadonlySet<string> = new Set([
  "every",
  "filter",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some",
]);

export const isSynchronousIteratorCallback = (functionNode: EsTreeNode): boolean => {
  const callNode = functionNode.parent;
  if (!isNodeOfType(callNode, "CallExpression")) return false;
  const callee = stripParenExpression(callNode.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier")
  ) {
    return false;
  }
  if (
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Array" &&
    callee.property.name === "from"
  ) {
    return callNode.arguments[1] === functionNode;
  }
  return (
    SYNCHRONOUS_ITERATOR_METHOD_NAMES.has(callee.property.name) &&
    callNode.arguments[0] === functionNode
  );
};
