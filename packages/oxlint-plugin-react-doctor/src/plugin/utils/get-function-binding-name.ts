import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isNodeOfType } from "./is-node-of-type.js";

// The Identifier a function is bound to: its own id (`function foo() {}`),
// the variable it initializes (`const foo = () => {}`), the identifier it
// is assigned to (`foo = () => {}`), or the variable initialized by a
// wrapping call (`const foo = memo(() => {})`). Null for anonymous positions.
export const getFunctionBindingIdentifier = (
  functionNode: EsTreeNode,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (
    isNodeOfType(functionNode, "FunctionDeclaration") &&
    isNodeOfType(functionNode.id, "Identifier")
  ) {
    return functionNode.id;
  }
  const functionRoot = findTransparentExpressionRoot(functionNode);
  const parent = functionRoot.parent;
  if (isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")) {
    return parent.id;
  }
  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    parent.right === functionRoot &&
    isNodeOfType(parent.left, "Identifier")
  ) {
    return parent.left;
  }
  if (isNodeOfType(parent, "CallExpression")) {
    const callParent = parent.parent;
    if (
      isNodeOfType(callParent, "VariableDeclarator") &&
      isNodeOfType(callParent.id, "Identifier")
    ) {
      return callParent.id;
    }
  }
  return null;
};

// The name a function is bound to — see `getFunctionBindingIdentifier`.
export const getFunctionBindingName = (functionNode: EsTreeNode): string | null =>
  getFunctionBindingIdentifier(functionNode)?.name ?? null;
