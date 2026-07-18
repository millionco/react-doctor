import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const getHandlerExpression = (attribute: EsTreeNode | null): EsTreeNode | null => {
  if (
    !attribute ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    !attribute.value ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer")
  ) {
    return null;
  }
  return attribute.value.expression;
};

const handlerCapturesItsPointer = (handler: EsTreeNode, context: RuleContext): boolean => {
  if (!isFunctionLike(handler)) return false;
  const eventParameter = handler.params?.[0];
  if (!isNodeOfType(eventParameter, "Identifier")) return false;
  const eventSymbol = context.scopes.symbolFor(eventParameter);
  if (!eventSymbol) return false;
  let capturesPointer = false;
  walkAst(handler.body, (child) => {
    if (capturesPointer) return false;
    if (isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = stripParenExpression(child.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return;
    if (getStaticPropertyName(callee) !== "setPointerCapture") return;
    const captureReceiver = stripParenExpression(callee.object);
    if (
      !isNodeOfType(captureReceiver, "MemberExpression") ||
      getStaticPropertyName(captureReceiver) !== "currentTarget" ||
      !isNodeOfType(stripParenExpression(captureReceiver.object), "Identifier")
    ) {
      return;
    }
    const captureEvent = stripParenExpression(captureReceiver.object);
    if (
      !isNodeOfType(captureEvent, "Identifier") ||
      context.scopes.referenceFor(captureEvent)?.resolvedSymbol?.id !== eventSymbol.id
    ) {
      return;
    }
    const pointerIdArgument = child.arguments?.[0];
    if (!pointerIdArgument || isNodeOfType(pointerIdArgument, "SpreadElement")) return;
    const pointerId = stripParenExpression(pointerIdArgument);
    if (
      !isNodeOfType(pointerId, "MemberExpression") ||
      getStaticPropertyName(pointerId) !== "pointerId" ||
      !isNodeOfType(stripParenExpression(pointerId.object), "Identifier")
    ) {
      return;
    }
    const pointerEvent = stripParenExpression(pointerId.object);
    if (
      !isNodeOfType(pointerEvent, "Identifier") ||
      context.scopes.referenceFor(pointerEvent)?.resolvedSymbol?.id !== eventSymbol.id
    ) {
      return;
    }
    capturesPointer = true;
    return false;
  });
  return capturesPointer;
};

export const pointerCaptureNeedsCancelHandler = defineRule({
  id: "pointer-capture-needs-cancel-handler",
  title: "Captured pointer interaction has no cancellation path",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Handle `onPointerCancel` or `onLostPointerCapture` with the same cleanup used for pointer-up so interrupted drags cannot stay active.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (
        !isNodeOfType(node.name, "JSXIdentifier") ||
        !/^[a-z]/.test(node.name.name) ||
        hasJsxSpreadAttribute(node.attributes)
      ) {
        return;
      }
      const pointerDownAttribute = getAuthoritativeJsxAttribute(node.attributes, "onPointerDown");
      const pointerMoveAttribute = getAuthoritativeJsxAttribute(node.attributes, "onPointerMove");
      const pointerUpAttribute = getAuthoritativeJsxAttribute(node.attributes, "onPointerUp");
      if (!pointerDownAttribute || !pointerMoveAttribute || !pointerUpAttribute) return;
      if (
        getAuthoritativeJsxAttribute(node.attributes, "onPointerCancel") ||
        getAuthoritativeJsxAttribute(node.attributes, "onPointerCancelCapture") ||
        getAuthoritativeJsxAttribute(node.attributes, "onLostPointerCapture") ||
        getAuthoritativeJsxAttribute(node.attributes, "onLostPointerCaptureCapture")
      ) {
        return;
      }
      const pointerDownExpression = getHandlerExpression(pointerDownAttribute);
      if (!pointerDownExpression) return;
      const pointerDownHandler = resolveExactLocalFunction(pointerDownExpression, context.scopes);
      if (!pointerDownHandler || !handlerCapturesItsPointer(pointerDownHandler, context)) return;

      context.report({
        node: pointerDownAttribute,
        message:
          "This drag captures a pointer and cleans up only on pointer-up. Add pointer-cancel or lost-capture cleanup for interruptions such as scrolling, app switches, or orientation changes.",
      });
    },
  }),
});
