import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const findJsxAttribute = (
  attributes: EsTreeNode[],
  attributeName: string,
): EsTreeNodeOfType<"JSXAttribute"> | undefined =>
  attributes?.find(
    (attribute): attribute is EsTreeNodeOfType<"JSXAttribute"> =>
      isNodeOfType(attribute, "JSXAttribute") &&
      isNodeOfType(attribute.name, "JSXIdentifier") &&
      attribute.name.name === attributeName,
  );
