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
    if (!attribute || isNodeOfType(attribute, "JSXSpreadAttribute")) return null;
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    const attributeName = getJsxAttributeName(attribute.name);
    const normalizedAttributeName = isCaseSensitive ? attributeName : attributeName?.toLowerCase();
    if (normalizedAttributeName === normalizedTargetName) return attribute;
  }
  return null;
};
