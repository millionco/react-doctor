import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { getApiReferenceProvenance } from "./get-api-reference-provenance.js";
import { hasThreeObjectProvenance } from "./has-three-object-provenance.js";
import { isThreeModuleSource } from "./is-three-module-source.js";
import { isThreeRendererReference } from "./is-three-renderer-reference.js";
import { resolveLocalReactCallback } from "./resolve-local-react-callback.js";
import { walkFunctionExecution } from "./walk-function-execution.js";

const callbackExecutesThreeWork = (callback: EsTreeNode, context: RuleContext): boolean => {
  let executesThreeWork = false;
  walkFunctionExecution(callback, context.scopes, (candidate) => {
    if (executesThreeWork) return;
    if (isNodeOfType(candidate, "NewExpression")) {
      const provenance = getApiReferenceProvenance(candidate.callee, context.scopes);
      executesThreeWork = Boolean(provenance && isThreeModuleSource(provenance.moduleSource));
      return;
    }
    if (
      isNodeOfType(candidate, "CallExpression") &&
      isNodeOfType(candidate.callee, "MemberExpression")
    ) {
      executesThreeWork = hasThreeObjectProvenance(candidate.callee.object, context.scopes);
      return;
    }
    const target = isNodeOfType(candidate, "AssignmentExpression")
      ? stripParenExpression(candidate.left)
      : isNodeOfType(candidate, "UpdateExpression")
        ? stripParenExpression(candidate.argument)
        : null;
    executesThreeWork = Boolean(
      target &&
      isNodeOfType(target, "MemberExpression") &&
      hasThreeObjectProvenance(target.object, context.scopes),
    );
  });
  return executesThreeWork;
};

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
  const callback = resolveLocalReactCallback(attribute.value.expression, context.scopes);
  return callback && callbackExecutesThreeWork(callback, context) ? callback : null;
};
