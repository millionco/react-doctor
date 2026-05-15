import { MUTATING_HTTP_METHODS, MUTATION_METHOD_NAMES } from "../constants/library.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isCookiesOrAwaitedCookiesCall } from "./is-cookies-or-awaited-cookies-call.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isSafeReceiverChain } from "./is-safe-receiver-chain.js";
import { walkAst } from "./walk-ast.js";

export interface FindSideEffectOptions {
  locallyScopedSafeBindings?: Set<string>;
  locallyScopedCookieBindings?: Set<string>;
}

const EMPTY_BINDING_SET = new Set<string>();

const COOKIE_MUTATION_METHOD_NAMES = new Set(["set", "append", "delete"]);

// HACK: extracted so `findSideEffect` can re-use the EXACT same shape
// predicate when it goes hunting for the literal method to render in
// the diagnostic. Previously `findSideEffect` used a looser `key.name
// === "method"` predicate and could pick a non-Literal `method:` entry
// (when duplicate keys are present), producing
// `"fetch() with method undefined"` in the message.
const isMutatingMethodProperty = (property: EsTreeNode): boolean =>
  isNodeOfType(property, "Property") &&
  isNodeOfType(property.key, "Identifier") &&
  property.key.name === "method" &&
  isNodeOfType(property.value, "Literal") &&
  typeof property.value.value === "string" &&
  MUTATING_HTTP_METHODS.has(property.value.value.toUpperCase());

const isCookieReceiver = (
  receiverNode: EsTreeNode,
  locallyScopedCookieBindings: Set<string>,
): boolean => {
  if (isCookiesOrAwaitedCookiesCall(receiverNode)) return true;
  if (isNodeOfType(receiverNode, "Identifier")) {
    return locallyScopedCookieBindings.has(receiverNode.name);
  }
  return false;
};

const getCookieMutationMethodName = (
  node: EsTreeNode,
  locallyScopedCookieBindings: Set<string>,
): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  if (!isNodeOfType(node.callee, "MemberExpression")) return null;
  if (!isNodeOfType(node.callee.property, "Identifier")) return null;
  if (!COOKIE_MUTATION_METHOD_NAMES.has(node.callee.property.name)) return null;
  if (!isCookieReceiver(node.callee.object, locallyScopedCookieBindings)) return null;
  return node.callee.property.name;
};

const isMutatingFetchCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "fetch") return false;
  const optionsArgument = node.arguments?.[1];
  if (!optionsArgument || !isNodeOfType(optionsArgument, "ObjectExpression")) return false;
  return Boolean(optionsArgument.properties?.some(isMutatingMethodProperty));
};

const isMutatingDbCall = (node: EsTreeNode, locallyScopedSafeBindings: Set<string>): boolean => {
  if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "MemberExpression"))
    return false;
  const { property, object } = node.callee;
  if (!isNodeOfType(property, "Identifier") || !MUTATION_METHOD_NAMES.has(property.name))
    return false;
  if (isSafeReceiverChain(object, locallyScopedSafeBindings)) return false;
  return true;
};

const getDbCallDescription = (node: EsTreeNode): string => {
  if (!isNodeOfType(node, "CallExpression")) return ".unknown()";
  if (!isNodeOfType(node.callee, "MemberExpression")) return ".unknown()";
  if (!isNodeOfType(node.callee.property, "Identifier")) return ".unknown()";
  const methodName = node.callee.property.name;
  const rootObjectName = isNodeOfType(node.callee.object, "Identifier")
    ? node.callee.object.name
    : null;
  return rootObjectName ? `${rootObjectName}.${methodName}()` : `.${methodName}()`;
};

export const findSideEffect = (
  node: EsTreeNode,
  options: FindSideEffectOptions = {},
): string | null => {
  const locallyScopedSafeBindings = options.locallyScopedSafeBindings ?? EMPTY_BINDING_SET;
  const locallyScopedCookieBindings = options.locallyScopedCookieBindings ?? EMPTY_BINDING_SET;

  let sideEffectDescription: string | null = null;
  walkAst(node, (child: EsTreeNode) => {
    if (sideEffectDescription) return;

    const cookieMethodName = getCookieMutationMethodName(child, locallyScopedCookieBindings);
    if (cookieMethodName) {
      sideEffectDescription = `cookies().${cookieMethodName}()`;
      return;
    }

    if (isMutatingFetchCall(child) && isNodeOfType(child, "CallExpression")) {
      // HACK: re-use the EXACT predicate `isMutatingFetchCall` already
      // matched on so we can't pick a non-Literal duplicate `method:`
      // entry by mistake (a looser `key.name === "method"` predicate
      // would).
      const optionsArgument = child.arguments[1];
      if (!isNodeOfType(optionsArgument, "ObjectExpression")) return;
      const methodProperty = optionsArgument.properties.find(isMutatingMethodProperty);
      if (
        !methodProperty ||
        !isNodeOfType(methodProperty, "Property") ||
        !isNodeOfType(methodProperty.value, "Literal")
      )
        return;
      sideEffectDescription = `fetch() with method ${methodProperty.value.value}`;
      return;
    }

    if (isMutatingDbCall(child, locallyScopedSafeBindings)) {
      sideEffectDescription = getDbCallDescription(child);
    }
  });
  return sideEffectDescription;
};
