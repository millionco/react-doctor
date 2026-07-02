import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

// The Identifier a function is bound to: its own id (`function foo() {}`),
// the variable it initializes (`const foo = () => {}`), or the identifier it
// is assigned to (`foo = () => {}`). Null for anonymous positions.
export const getFunctionBindingIdentifier = (
  functionNode: EsTreeNode,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (
    isNodeOfType(functionNode, "FunctionDeclaration") &&
    isNodeOfType(functionNode.id, "Identifier")
  ) {
    return functionNode.id;
  }
  const parent = functionNode.parent;
  if (isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")) {
    return parent.id;
  }
  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    parent.right === functionNode &&
    isNodeOfType(parent.left, "Identifier")
  ) {
    return parent.left;
  }
  return null;
};

// The name a function is bound to — see `getFunctionBindingIdentifier`.
export const getFunctionBindingName = (functionNode: EsTreeNode): string | null =>
  getFunctionBindingIdentifier(functionNode)?.name ?? null;
