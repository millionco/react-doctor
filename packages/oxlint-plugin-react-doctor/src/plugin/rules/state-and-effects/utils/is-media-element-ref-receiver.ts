import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
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
  receiverCache?: WeakMap<SymbolDescriptor, boolean>,
): boolean => {
  const refSymbol = resolveReactRefCurrentOriginSymbol(expression, scopes);
  if (!refSymbol) return false;
  const cachedResult = receiverCache?.get(refSymbol);
  if (cachedResult !== undefined) return cachedResult;
  receiverCache?.set(refSymbol, false);
  const initializer = getDirectConstInitializer(refSymbol);
  if (!initializer) return false;
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
    const ownerFunction = findEnclosingFunction(refSymbol.declarationNode);
    const mediaElement = openingElement.parent;
    if (!ownerFunction || !isNodeOfType(mediaElement, "JSXElement")) return false;
    const pendingRenderValues: EsTreeNode[] = [mediaElement];
    const visitedRenderValues = new Set<EsTreeNode>();
    let isReturnedMedia = false;
    while (pendingRenderValues.length > 0) {
      const pendingRenderValue = pendingRenderValues.pop();
      if (!pendingRenderValue) return false;
      const renderValue = findTransparentExpressionRoot(pendingRenderValue);
      if (visitedRenderValues.has(renderValue)) continue;
      visitedRenderValues.add(renderValue);
      const renderParent = renderValue.parent;
      if (
        isNodeOfType(renderParent, "ReturnStatement") &&
        renderParent.argument === renderValue &&
        findEnclosingFunction(renderParent) === ownerFunction
      ) {
        isReturnedMedia = true;
        continue;
      }
      if (
        (isNodeOfType(renderParent, "ConditionalExpression") &&
          (renderParent.consequent === renderValue || renderParent.alternate === renderValue)) ||
        (isNodeOfType(renderParent, "LogicalExpression") &&
          (renderParent.right === renderValue || renderParent.operator !== "&&")) ||
        (isNodeOfType(renderParent, "ArrayExpression") &&
          renderParent.elements.some((element) => element === renderValue))
      ) {
        pendingRenderValues.push(renderParent);
        continue;
      }
      const container = isNodeOfType(renderParent, "JSXExpressionContainer")
        ? renderParent
        : renderValue;
      const containingElement = container.parent;
      if (
        (isNodeOfType(containingElement, "JSXFragment") ||
          (isNodeOfType(containingElement, "JSXElement") &&
            isProvenIntrinsicJsxElement(containingElement.openingElement, scopes))) &&
        containingElement.children.some((child) => child === container)
      ) {
        pendingRenderValues.push(containingElement);
        continue;
      }
      if (
        isNodeOfType(renderParent, "VariableDeclarator") &&
        renderParent.init === renderValue &&
        isNodeOfType(renderParent.id, "Identifier")
      ) {
        const renderSymbol = scopes.symbolFor(renderParent.id);
        if (
          !renderSymbol ||
          getDirectConstInitializer(renderSymbol) !== renderValue ||
          renderSymbol.references.length !== 1 ||
          renderSymbol.references[0]?.flag !== "read"
        ) {
          return false;
        }
        pendingRenderValues.push(renderSymbol.references[0].identifier);
      }
    }
    if (!isReturnedMedia) return false;
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
  receiverCache?.set(refSymbol, true);
  return true;
};
