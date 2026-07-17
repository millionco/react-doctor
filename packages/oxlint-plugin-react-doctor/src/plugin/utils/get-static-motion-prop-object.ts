import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "./get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenFramerMotionJsxElement } from "./is-proven-framer-motion-jsx-element.js";

export const getStaticMotionPropObject = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  propertyName: string,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  if (!isProvenFramerMotionJsxElement(openingElement, scopes)) return null;
  const attribute = getAuthoritativeJsxAttribute(openingElement.attributes, propertyName);
  if (
    !attribute?.value ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
    !isNodeOfType(attribute.value.expression, "ObjectExpression")
  ) {
    return null;
  }
  return attribute.value.expression;
};
