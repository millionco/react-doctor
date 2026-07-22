import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { isThreeRendererReference } from "./is-three-renderer-reference.js";
import { resolveLocalReactCallback } from "./resolve-local-react-callback.js";

const getPointerMoveListenerCallback = (
  node: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    !isNodeOfType(node.callee, "MemberExpression") ||
    getStaticPropertyName(node.callee) !== "addEventListener"
  ) {
    return null;
  }
  const eventName = node.arguments[0];
  const callback = node.arguments[1];
  const listenerTarget = stripParenExpression(node.callee.object);
  if (
    !eventName ||
    isNodeOfType(eventName, "SpreadElement") ||
    !isNodeOfType(eventName, "Literal") ||
    eventName.value !== "pointermove" ||
    !callback ||
    isNodeOfType(callback, "SpreadElement") ||
    !isNodeOfType(listenerTarget, "MemberExpression") ||
    getStaticPropertyName(listenerTarget) !== "domElement" ||
    !isThreeRendererReference(listenerTarget.object, context.scopes)
  ) {
    return null;
  }
  return resolveLocalReactCallback(callback, context.scopes);
};

export const resolveThreePointerMoveCallback = (
  node: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  if (isNodeOfType(node, "CallExpression")) {
    return getPointerMoveListenerCallback(node, context);
  }
  if (!isNodeOfType(node, "JSXOpeningElement") || resolveJsxElementType(node) !== "canvas") {
    return null;
  }
  const attribute = getAuthoritativeJsxAttribute(node.attributes, "onPointerMove");
  if (
    !attribute?.value ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
    isNodeOfType(attribute.value.expression, "JSXEmptyExpression")
  ) {
    return null;
  }
  return resolveLocalReactCallback(attribute.value.expression, context.scopes);
};
