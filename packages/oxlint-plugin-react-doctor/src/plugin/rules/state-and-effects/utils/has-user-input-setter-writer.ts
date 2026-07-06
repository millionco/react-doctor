import type { Reference } from "eslint-scope";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getFunctionBindingName } from "../../../utils/get-function-binding-name.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isEventHandlerName } from "./event-handler-reference.js";
import { isSetterWiredToJsxHandler } from "./is-controlled-prop-mirror.js";

const HANDLER_BINDING_NAME_PATTERN = /^(on|handle)[A-Z_]/;

const isEventHandlerPropertyKey = (property: EsTreeNode): boolean =>
  isNodeOfType(property, "Property") &&
  !property.computed &&
  isNodeOfType(property.key, "Identifier") &&
  isEventHandlerName(property.key.name);

const DEFERRED_CALLBACK_MEMBER_NAMES = new Set(["then", "catch", "finally", "subscribe"]);
const DEFERRED_CALLBACK_CALLEE_NAMES = new Set([
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "addEventListener",
  "addListener",
]);

const isDeferredCallbackArgumentOf = (callExpr: EsTreeNode, child: EsTreeNode): boolean => {
  if (!isNodeOfType(callExpr, "CallExpression")) return false;
  if (!(callExpr.arguments ?? []).includes(child as (typeof callExpr.arguments)[number])) {
    return false;
  }
  const callee = callExpr.callee;
  if (isNodeOfType(callee, "Identifier")) return DEFERRED_CALLBACK_CALLEE_NAMES.has(callee.name);
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    return (
      DEFERRED_CALLBACK_MEMBER_NAMES.has(callee.property.name) ||
      DEFERRED_CALLBACK_CALLEE_NAMES.has(callee.property.name)
    );
  }
  return false;
};

// True when this setter reference sits in a user-input write path: inside
// a JSX `on*` attribute value, inside an `on*`-keyed object property
// (gesture/config callbacks), or inside a component-body function that is
// itself a handler — named `on*`/`handle*`, or wired into a JSX `on*`
// attribute anywhere in the component. `includeDeferredWriters` extends
// the classification to async writers: subscription / promise / timer
// callbacks and `async` functions.
const isIndependentWriterIdentifier = (
  componentFunction: EsTreeNode,
  identifier: EsTreeNode,
  includeDeferredWriters: boolean,
): boolean => {
  let outermostFunctionBelowComponent: EsTreeNode | null = null;
  let previous: EsTreeNode = identifier;
  let cursor: EsTreeNode | null | undefined = identifier.parent;
  while (cursor && cursor !== componentFunction) {
    if (isNodeOfType(cursor, "JSXAttribute")) {
      const attributeName = getJsxAttributeName(cursor.name);
      if (attributeName && isEventHandlerName(attributeName)) return true;
    }
    if (isEventHandlerPropertyKey(cursor)) return true;
    if (includeDeferredWriters && isDeferredCallbackArgumentOf(cursor, previous)) return true;
    if (isFunctionLike(cursor)) {
      outermostFunctionBelowComponent = cursor;
      if (includeDeferredWriters && (cursor as unknown as { async?: boolean }).async === true) {
        return true;
      }
    }
    previous = cursor;
    cursor = cursor.parent ?? null;
  }
  if (!outermostFunctionBelowComponent) return false;
  const bindingName = getFunctionBindingName(outermostFunctionBelowComponent);
  if (!bindingName) return false;
  if (HANDLER_BINDING_NAME_PATTERN.test(bindingName)) return true;
  return isSetterWiredToJsxHandler(componentFunction, bindingName);
};

// The state behind `setterRef` has an independent writer: some OTHER
// reference to the same setter binding (outside the flagged effect)
// writes it from an event-handler path — or, with
// `includeDeferredWriters`, from a subscription / promise / timer / async
// callback. Such state carries information (user input, async results)
// that no render-time derivation can reproduce.
export const hasUserInputSetterWriter = (
  setterRef: Reference,
  effectNode: EsTreeNode,
  includeDeferredWriters = false,
): boolean => {
  if (!setterRef.resolved) return false;
  const componentFunction = findEnclosingFunction(effectNode);
  if (!componentFunction) return false;
  for (const reference of setterRef.resolved.references) {
    if (reference.init) continue;
    const identifier = reference.identifier as unknown as EsTreeNode;
    if (isAstDescendant(identifier, effectNode)) continue;
    if (isIndependentWriterIdentifier(componentFunction, identifier, includeDeferredWriters)) {
      return true;
    }
  }
  return false;
};
