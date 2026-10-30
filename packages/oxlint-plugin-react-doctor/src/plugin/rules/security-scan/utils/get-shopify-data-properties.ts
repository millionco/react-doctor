import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { SHOPIFY_FORBIDDEN_SELECTORS } from "./shopify-webhook-constants.js";

export const getShopifyDataProperties = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const properties = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.method ||
      property.computed
    )
      return null;
    const name = getResolvedStaticPropertyName(property, scopes);
    if (name === null || properties.has(name) || SHOPIFY_FORBIDDEN_SELECTORS.has(name)) return null;
    properties.set(name, property.value);
  }
  return properties;
};
