import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const findJsxAttribute = (
  attributes: EsTreeNode[],
  attributeName: string,
): EsTreeNode | undefined =>
  attributes?.find(
    (attribute: EsTreeNode) =>
      isNodeOfType(attribute, "JSXAttribute") &&
      isNodeOfType(attribute.name, "JSXIdentifier") &&
      attribute.name.name === attributeName,
  );
