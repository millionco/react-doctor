import type { EsTreeNode } from "./es-tree-node.js";
import { findJsxAttribute } from "./find-jsx-attribute.js";

export const hasJsxAttribute = (attributes: EsTreeNode[], attributeName: string): boolean =>
  Boolean(findJsxAttribute(attributes, attributeName));
