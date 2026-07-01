import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// The name a function is bound to: its own id (`function foo() {}`), the
// variable it initializes (`const foo = () => {}`), or the identifier it is
// assigned to (`foo = () => {}`). Null for anonymous positions.
export const getFunctionBindingName = (functionNode: EsTreeNode): string | null => {
  if (
    isNodeOfType(functionNode, "FunctionDeclaration") &&
    isNodeOfType(functionNode.id, "Identifier")
  ) {
    return functionNode.id.name;
  }
  const parent = functionNode.parent;
  if (isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")) {
    return parent.id.name;
  }
  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    parent.right === functionNode &&
    isNodeOfType(parent.left, "Identifier")
  ) {
    return parent.left.name;
  }
  return null;
};
