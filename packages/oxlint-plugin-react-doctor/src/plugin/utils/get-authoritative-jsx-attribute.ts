import { canExpressionOverrideJsxAttribute } from "./can-expression-override-jsx-attribute.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getJsxAttributeName } from "./get-jsx-attribute-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getAuthoritativeJsxAttribute = (
  attributes: ReadonlyArray<EsTreeNode>,
  targetName: string,
  isCaseSensitive = true,
): EsTreeNodeOfType<"JSXAttribute"> | null => {
  const normalizedTargetName = isCaseSensitive ? targetName : targetName.toLowerCase();
  for (let attributeIndex = attributes.length - 1; attributeIndex >= 0; attributeIndex -= 1) {
    const attribute = attributes[attributeIndex];
    if (!attribute) return null;
    if (isNodeOfType(attribute, "JSXSpreadAttribute")) {
      if (canExpressionOverrideJsxAttribute(attribute.argument, targetName, isCaseSensitive)) {
        return null;
      }
      continue;
    }
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    const attributeName = getJsxAttributeName(attribute.name);
    const normalizedAttributeName = isCaseSensitive ? attributeName : attributeName?.toLowerCase();
    if (normalizedAttributeName === normalizedTargetName) return attribute;
  }
  return null;
};
