import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { getR3fBufferAttributeName } from "./get-r3f-buffer-attribute-name.js";

export interface ClosedR3fBufferGeometryAttributes {
  attributeNames: ReadonlySet<string>;
  isComplete: boolean;
}

export const getClosedR3fBufferGeometryAttributes = (
  node: EsTreeNodeOfType<"JSXElement">,
  scopes: ScopeAnalysis,
): ClosedR3fBufferGeometryAttributes => {
  const openingElement = node.openingElement;
  if (
    openingElement.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute")) ||
    getAuthoritativeJsxAttribute(openingElement.attributes, "ref") ||
    getAuthoritativeJsxAttribute(openingElement.attributes, "onUpdate")
  ) {
    return { attributeNames: new Set(), isComplete: false };
  }
  const attributeNames = new Set<string>();
  let isComplete = true;
  for (const child of node.children) {
    if (isNodeOfType(child, "JSXText") && child.value.trim() === "") continue;
    if (isNodeOfType(child, "JSXExpressionContainer")) {
      if (!isNodeOfType(child.expression, "JSXEmptyExpression")) isComplete = false;
      continue;
    }
    if (!isNodeOfType(child, "JSXElement")) {
      isComplete = false;
      continue;
    }
    const attributeName = getR3fBufferAttributeName(child.openingElement, scopes);
    if (attributeName) attributeNames.add(attributeName);
    else isComplete = false;
  }
  return { attributeNames, isComplete };
};
