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

const handlerCapturesItsPointer = (handler: EsTreeNode): boolean => {
  if (!isFunctionLike(handler)) return false;
  const eventParameter = handler.params?.[0];
  if (!isNodeOfType(eventParameter, "Identifier")) return false;
  let capturesPointer = false;
  walkAst(handler.body, (child) => {
    if (capturesPointer) return false;
    if (isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression") || !isNodeOfType(child.callee, "MemberExpression")) {
      return;
    }
    if (getStaticPropertyName(child.callee) !== "setPointerCapture") return;
    const captureReceiver = child.callee.object;
    if (
      !isNodeOfType(captureReceiver, "MemberExpression") ||
      getStaticPropertyName(captureReceiver) !== "currentTarget" ||
      !isNodeOfType(captureReceiver.object, "Identifier") ||
      captureReceiver.object.name !== eventParameter.name
    ) {
      return;
    }
    const pointerId = child.arguments?.[0];
    if (
      !isNodeOfType(pointerId, "MemberExpression") ||
      getStaticPropertyName(pointerId) !== "pointerId" ||
      !isNodeOfType(pointerId.object, "Identifier") ||
      pointerId.object.name !== eventParameter.name
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
      if (!pointerDownHandler || !handlerCapturesItsPointer(pointerDownHandler)) return;

      context.report({
        node: pointerDownAttribute,
        message:
          "This drag captures a pointer and cleans up only on pointer-up. Add pointer-cancel or lost-capture cleanup for interruptions such as scrolling, app switches, or orientation changes.",
      });
    },
  }),
});
