import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Walks up from a binding Identifier to its enclosing VariableDeclarator.
// Null when the binding is not variable-declared (a parameter, an import
// specifier, a function declaration) — the walk stops at the nearest
// function or Program boundary.
export const findDeclaratorForBinding = (
  bindingIdentifier: EsTreeNode,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  let ancestor: EsTreeNode | null | undefined = bindingIdentifier.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "VariableDeclarator")) return ancestor;
    if (
      isNodeOfType(ancestor, "FunctionDeclaration") ||
      isNodeOfType(ancestor, "FunctionExpression") ||
      isNodeOfType(ancestor, "ArrowFunctionExpression") ||
      isNodeOfType(ancestor, "Program")
    ) {
      return null;
    }
    ancestor = ancestor.parent ?? null;
  }
  return null;
};
