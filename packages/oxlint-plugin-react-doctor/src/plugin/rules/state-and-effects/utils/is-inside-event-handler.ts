import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const isInsideEventHandler = (
  node: EsTreeNode,
  handlerBindingNames: Set<string>,
): boolean => {
  let cursor: EsTreeNode | null = node.parent ?? null;
  while (cursor) {
    if (
      isNodeOfType(cursor, "ArrowFunctionExpression") ||
      isNodeOfType(cursor, "FunctionExpression") ||
      isNodeOfType(cursor, "FunctionDeclaration")
    ) {
      let outer: EsTreeNode | null = cursor.parent ?? null;
      while (outer) {
        if (isNodeOfType(outer, "JSXAttribute")) {
          const attrName = isNodeOfType(outer.name, "JSXIdentifier") ? outer.name.name : null;
          if (attrName && /^on[A-Z]/.test(attrName)) return true;
          return false;
        }
        if (isNodeOfType(outer, "VariableDeclarator")) {
          const declaredName = isNodeOfType(outer.id, "Identifier") ? outer.id.name : null;
          return Boolean(declaredName && handlerBindingNames.has(declaredName));
        }
        if (isNodeOfType(outer, "Program")) return false;
        outer = outer.parent ?? null;
      }
      return false;
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};
