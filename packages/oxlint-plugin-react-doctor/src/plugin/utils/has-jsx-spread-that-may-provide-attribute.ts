import { canExpressionOverrideJsxAttribute } from "./can-expression-override-jsx-attribute.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const hasJsxSpreadThatMayProvideAttribute = (
  attributes: ReadonlyArray<EsTreeNode>,
  attributeName: string,
): boolean =>
  attributes.some(
    (attribute) =>
      isNodeOfType(attribute, "JSXSpreadAttribute") &&
      canExpressionOverrideJsxAttribute(attribute.argument, attributeName, false),
  );
