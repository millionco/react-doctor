import type { EsTreeNode } from "./es-tree-node.js";
import { getClosedIntrinsicJsxTreeProof } from "./get-closed-intrinsic-jsx-tree-proof.js";
import type { IntrinsicJsxScanBudget } from "./get-closed-intrinsic-jsx-tree-proof.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface ClosedIntrinsicJsxMapCallback {
  readonly childName: string;
  readonly indexName: string;
  readonly hasItemChild: boolean;
}

export const getClosedIntrinsicJsxMapCallback = (
  callback: EsTreeNode | null | undefined,
  budget: IntrinsicJsxScanBudget,
): ClosedIntrinsicJsxMapCallback | null => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 2
  )
    return null;
  const [childParameter, indexParameter] = callback.params;
  if (!isNodeOfType(childParameter, "Identifier") || !isNodeOfType(indexParameter, "Identifier"))
    return null;
  const proof = getClosedIntrinsicJsxTreeProof(callback.body, budget, {
    childName: childParameter.name,
    indexName: indexParameter.name,
  });
  if (!proof) return null;
  const body = stripParenExpression(callback.body);
  if (!isNodeOfType(body, "JSXElement")) return null;
  let hasIndexKey = false;
  for (const attribute of body.openingElement.attributes) {
    if (
      !isNodeOfType(attribute, "JSXAttribute") ||
      !isNodeOfType(attribute.name, "JSXIdentifier") ||
      attribute.name.name !== "key"
    )
      continue;
    if (hasIndexKey || !isNodeOfType(attribute.value, "JSXExpressionContainer")) return null;
    const value = stripParenExpression(attribute.value.expression);
    if (!isNodeOfType(value, "Identifier") || value.name !== indexParameter.name) return null;
    hasIndexKey = true;
  }
  if (!hasIndexKey) return null;
  return {
    childName: childParameter.name,
    indexName: indexParameter.name,
    hasItemChild: proof.hasItemChild,
  };
};
