import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";
import { readConstantBoolean } from "../../../utils/read-constant-boolean.js";
import {
  REF_NOTIFICATION_EVENT_ANCESTOR_TAGS,
  REF_NOTIFICATION_UNSUPPORTED_RENDER_CONTROL_TYPES,
} from "./constants.js";
import { isClosedRefNotificationRenderHelper } from "./is-closed-ref-notification-render-helper.js";
import { isRefNotificationNativeElement } from "./is-ref-notification-native-element.js";

const isReturnedNativeEventPosition = (
  node: EsTreeNode,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  let branch = node;
  let ancestor = node.parent;
  while (ancestor && ancestor !== owner) {
    if (isNodeOfType(ancestor, "IfStatement")) {
      const condition = readConstantBoolean(ancestor.test, context.scopes);
      if (
        ancestor.test === branch ||
        (ancestor.consequent === branch && condition === false) ||
        (ancestor.alternate === branch && condition === true)
      )
        return false;
    }
    if (REF_NOTIFICATION_UNSUPPORTED_RENDER_CONTROL_TYPES.has(ancestor.type)) return false;
    branch = ancestor;
    ancestor = ancestor.parent;
  }
  let cursor: EsTreeNode = node;
  while (cursor) {
    const root = findTransparentExpressionRoot(cursor);
    const parent = root.parent;
    if (isNodeOfType(parent, "ReturnStatement"))
      return (
        parent.argument === root &&
        findEnclosingFunction(parent) === owner &&
        isNodeReachableWithinFunction(node, context)
      );
    if (isNodeOfType(parent, "ArrowFunctionExpression") && parent === owner && parent.body === root)
      return isNodeReachableWithinFunction(node, context);
    if (isNodeOfType(parent, "LogicalExpression")) {
      if (
        parent.operator !== "&&" ||
        parent.right !== root ||
        readConstantBoolean(parent.left, context.scopes) === false
      )
        return false;
      cursor = parent;
      continue;
    }
    if (isNodeOfType(parent, "ConditionalExpression")) {
      const condition = readConstantBoolean(parent.test, context.scopes);
      if (
        parent.test === root ||
        (parent.consequent === root && condition === false) ||
        (parent.alternate === root && condition === true)
      )
        return false;
      cursor = parent;
      continue;
    }
    if (
      (isNodeOfType(parent, "JSXElement") || isNodeOfType(parent, "JSXFragment")) &&
      parent.children.some((child) => child === root)
    ) {
      if (
        isNodeOfType(parent, "JSXElement") &&
        (!isRefNotificationNativeElement(parent, context.scopes, true) ||
          REF_NOTIFICATION_EVENT_ANCESTOR_TAGS.has(resolveJsxElementType(parent.openingElement)))
      )
        return false;
      cursor = parent;
      continue;
    }
    if (isNodeOfType(parent, "JSXExpressionContainer") && parent.expression === root) {
      cursor = parent;
      continue;
    }
    return false;
  }
  return false;
};

export const isRefNotificationNativeEvent = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  component: EsTreeNode,
  context: RuleContext,
): boolean => {
  const opening = attribute.parent;
  const element = opening?.parent;
  const owner = findEnclosingFunction(attribute);
  if (
    !owner ||
    getJsxAttributeName(attribute.name) !== "onClick" ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(element, "JSXElement") ||
    getAuthoritativeJsxAttribute(opening.attributes, "onClick") !== attribute ||
    !isRefNotificationNativeElement(element, context.scopes, false) ||
    !isReturnedNativeEventPosition(element, owner, context)
  )
    return false;
  if (owner === component) return true;
  const program = findProgramRoot(attribute);
  return Boolean(
    program &&
    isClosedRefNotificationRenderHelper({
      helper: owner,
      component,
      program,
      context,
      isRenderedCall: (call) => isReturnedNativeEventPosition(call, component, context),
    }),
  );
};
