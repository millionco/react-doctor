import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenIntrinsicJsxElement } from "../../../utils/is-proven-intrinsic-jsx-element.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveReactRefCurrentOriginSymbol } from "../../../utils/react-ref-origin.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const isMediaElementRefReceiver = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const refSymbol = resolveReactRefCurrentOriginSymbol(expression, scopes);
  const initializer = refSymbol ? getDirectConstInitializer(refSymbol) : null;
  if (!refSymbol || !initializer) return false;
  const refCall = stripParenExpression(initializer);
  if (!isNodeOfType(refCall, "CallExpression")) return false;
  const initialValue = refCall.arguments[0];
  if (!isNodeOfType(initialValue, "Literal") || initialValue.value !== null) return false;
  let hasMediaAttachment = false;
  const pendingElementValues: EsTreeNode[] = [];
  for (const reference of refSymbol.references) {
    if (reference.flag !== "read") return false;
    const refExpression = findTransparentExpressionRoot(reference.identifier);
    const parent = refExpression.parent;
    if (
      isNodeOfType(parent, "MemberExpression") &&
      parent.object === refExpression &&
      getStaticPropertyName(parent) === "current"
    ) {
      pendingElementValues.push(parent);
      continue;
    }
    if (!isNodeOfType(parent, "JSXExpressionContainer")) return false;
    const attribute = parent.parent;
    if (!isNodeOfType(attribute, "JSXAttribute") || getJsxAttributeName(attribute.name) !== "ref") {
      return false;
    }
    const openingElement = attribute.parent;
    if (
      !isNodeOfType(openingElement, "JSXOpeningElement") ||
      !isProvenIntrinsicJsxElement(openingElement, scopes)
    ) {
      return false;
    }
    const elementName = resolveJsxElementType(openingElement);
    if (elementName !== "audio" && elementName !== "video") return false;
    if (hasMediaAttachment) return false;
    if (
      openingElement.attributes.some(
        (siblingAttribute) =>
          isNodeOfType(siblingAttribute, "JSXSpreadAttribute") ||
          (siblingAttribute !== attribute &&
            isNodeOfType(siblingAttribute, "JSXAttribute") &&
            getJsxAttributeName(siblingAttribute.name) === "ref"),
      )
    ) {
      return false;
    }
    hasMediaAttachment = true;
  }
  if (!hasMediaAttachment) return false;
  const visitedElementSymbols = new Set<number>();
  while (pendingElementValues.length > 0) {
    const pendingValue = pendingElementValues.pop();
    if (!pendingValue) return false;
    const elementValue = findTransparentExpressionRoot(pendingValue);
    if (isWithinAssignmentTarget(elementValue)) return false;
    const parent = elementValue.parent;
    if (
      (isNodeOfType(parent, "MemberExpression") &&
        parent.object === elementValue &&
        getStaticPropertyName(parent) !== null) ||
      (isNodeOfType(parent, "IfStatement") && parent.test === elementValue) ||
      (isNodeOfType(parent, "ConditionalExpression") && parent.test === elementValue) ||
      (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") ||
      (isNodeOfType(parent, "BinaryExpression") &&
        (parent.operator === "===" ||
          parent.operator === "!==" ||
          parent.operator === "==" ||
          parent.operator === "!="))
    ) {
      continue;
    }
    if (
      !isNodeOfType(parent, "VariableDeclarator") ||
      parent.init !== elementValue ||
      !isNodeOfType(parent.id, "Identifier")
    ) {
      return false;
    }
    const aliasSymbol = scopes.symbolFor(parent.id);
    if (!aliasSymbol || getDirectConstInitializer(aliasSymbol) !== elementValue) return false;
    if (visitedElementSymbols.has(aliasSymbol.id)) continue;
    visitedElementSymbols.add(aliasSymbol.id);
    for (const reference of aliasSymbol.references) {
      if (reference.flag !== "read") return false;
      pendingElementValues.push(reference.identifier);
    }
  }
  return true;
};
