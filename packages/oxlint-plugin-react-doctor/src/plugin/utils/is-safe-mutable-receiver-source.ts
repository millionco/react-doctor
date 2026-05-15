import {
  RESPONSE_FACTORY_METHODS,
  RESPONSE_FACTORY_OBJECTS,
  SAFE_MUTABLE_CONSTRUCTOR_NAMES,
} from "../constants/library.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

const SAFE_INTRINSIC_PROPERTY_NAMES = new Set(["headers", "searchParams"]);

const unwrapAwait = (node: EsTreeNode): EsTreeNode =>
  isNodeOfType(node, "AwaitExpression") && node.argument ? node.argument : node;

const isSafeConstructorNew = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "NewExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  SAFE_MUTABLE_CONSTRUCTOR_NAMES.has(node.callee.name);

const isResponseFactoryCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;
  if (!isNodeOfType(node.callee.object, "Identifier")) return false;
  if (!isNodeOfType(node.callee.property, "Identifier")) return false;
  return (
    RESPONSE_FACTORY_OBJECTS.has(node.callee.object.name) &&
    RESPONSE_FACTORY_METHODS.has(node.callee.property.name)
  );
};

// `headers()` from `next/headers` returns a ReadonlyHeaders — every
// mutating call would throw at runtime, so it can never represent
// server-state mutation. Including aliases (`const h = headers()`) here
// makes them get collected by `collectLocallyScopedSafeBindings` and
// silently skipped by the rule.
const isHeadersFunctionCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  node.callee.name === "headers";

// HACK: `something.headers` is always a Headers instance, `something.searchParams`
// is always a URLSearchParams. Catching these by property name lets us
// short-circuit without resolving the receiver's actual type — handles
// the issue #206 shape `await v2GET(req, ctx); res.headers.set(...)` where
// we have no way to know that `v2GET` returns a Response.
const isSafeIntrinsicMemberAccess = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  isNodeOfType(node.property, "Identifier") &&
  SAFE_INTRINSIC_PROPERTY_NAMES.has(node.property.name);

export const isSafeMutableReceiverSource = (initNode: EsTreeNode): boolean => {
  const unwrapped = unwrapAwait(initNode);
  if (isSafeConstructorNew(unwrapped)) return true;
  if (isResponseFactoryCall(unwrapped)) return true;
  if (isSafeIntrinsicMemberAccess(unwrapped)) return true;
  if (isHeadersFunctionCall(unwrapped)) return true;
  return false;
};

export const isSafeReceiverChainNode = (
  node: EsTreeNode,
  locallyScopedSafeBindings: Set<string>,
): boolean => {
  if (isSafeConstructorNew(node)) return true;
  if (isResponseFactoryCall(node)) return true;
  if (isSafeIntrinsicMemberAccess(node)) return true;
  if (isHeadersFunctionCall(node)) return true;
  if (isNodeOfType(node, "Identifier") && locallyScopedSafeBindings.has(node.name)) return true;
  return false;
};
