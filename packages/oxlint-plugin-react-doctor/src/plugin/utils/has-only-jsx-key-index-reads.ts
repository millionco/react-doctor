import type { EsTreeNode } from "./es-tree-node.js";
import { findVariableInitializer } from "./find-variable-initializer.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

export const hasOnlyJsxKeyIndexReads = (callback: EsTreeNode): boolean => {
  if (!isFunctionLike(callback)) return false;
  const indexParameter = callback.params[1];
  if (!isNodeOfType(indexParameter, "Identifier")) return false;
  let hasOtherRead = false;
  walkAst(callback.body, (node) => {
    if (hasOtherRead) return false;
    if (!isNodeOfType(node, "Identifier") || node.name !== indexParameter.name) return;
    if (findVariableInitializer(node, node.name)?.bindingIdentifier !== indexParameter) return;
    const expression = node.parent;
    const attribute = expression?.parent;
    if (
      !isNodeOfType(expression, "JSXExpressionContainer") ||
      !isNodeOfType(attribute, "JSXAttribute") ||
      !isNodeOfType(attribute.name, "JSXIdentifier") ||
      attribute.name.name !== "key"
    )
      hasOtherRead = true;
  });
  return !hasOtherRead;
};
