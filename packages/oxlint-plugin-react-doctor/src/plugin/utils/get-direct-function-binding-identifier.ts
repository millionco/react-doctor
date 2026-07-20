import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getDirectFunctionBindingIdentifier = (
  functionNode: EsTreeNode,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (
    isNodeOfType(functionNode, "FunctionDeclaration") &&
    isNodeOfType(functionNode.id, "Identifier")
  ) {
    return functionNode.id;
  }
  const functionValueRoot = findTransparentExpressionRoot(functionNode);
  const parent = functionValueRoot.parent;
  return isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === functionValueRoot &&
    isNodeOfType(parent.id, "Identifier")
    ? parent.id
    : null;
};
