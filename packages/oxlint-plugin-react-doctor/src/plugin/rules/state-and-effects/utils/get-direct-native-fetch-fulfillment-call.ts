import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { getPromiseChainCallForCallback } from "../../../utils/collect-effect-invoked-functions.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getStaticStringExpression } from "../../../utils/get-static-string-expression.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const OPAQUE_PROVIDER_GLOBALS = new Set([
  "Promise",
  "Object",
  "Reflect",
  "Proxy",
  "Function",
  "eval",
  "globalThis",
  "window",
  "self",
  "global",
  "require",
]);
const PROTOTYPE_ACCESS_NAMES = new Set(["constructor", "prototype", "__proto__"]);
const opaqueProviderAccessByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

const hasOpaqueProviderAccess = (scopes: ScopeAnalysis): boolean => {
  const cached = opaqueProviderAccessByAnalysis.get(scopes);
  if (cached !== undefined) return cached;
  let hasOpaqueAccess = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasOpaqueAccess) return false;
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "ThisExpression") ||
      isNodeOfType(node, "MetaProperty") ||
      (isNodeOfType(node, "ImportDeclaration") && node.specifiers.length === 0)
    ) {
      hasOpaqueAccess = true;
    } else if (isNodeOfType(node, "Identifier") && scopes.isGlobalReference(node)) {
      if (OPAQUE_PROVIDER_GLOBALS.has(node.name)) {
        hasOpaqueAccess = true;
      } else if (node.name === "fetch") {
        const reference = findTransparentExpressionRoot(node);
        const call = reference.parent;
        hasOpaqueAccess = !isNodeOfType(call, "CallExpression") || call.callee !== reference;
      }
    } else if (isNodeOfType(node, "MemberExpression")) {
      const name = getStaticPropertyName(node);
      hasOpaqueAccess = name === null || PROTOTYPE_ACCESS_NAMES.has(name);
    } else if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const name = getStaticPropertyKeyName(node, { allowComputedString: true });
      hasOpaqueAccess = name === null || PROTOTYPE_ACCESS_NAMES.has(name);
    }
  });
  opaqueProviderAccessByAnalysis.set(scopes, hasOpaqueAccess);
  return hasOpaqueAccess;
};

export const getDirectNativeFetchFulfillmentCall = (
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (!isFunctionLike(callback) || callback.async || callback.generator) return null;
  const continuation = getPromiseChainCallForCallback(callback);
  if (
    !isNodeOfType(continuation, "CallExpression") ||
    continuation.optional ||
    continuation.arguments.length !== 1
  ) {
    return null;
  }
  const method = stripParenExpression(continuation.callee);
  if (
    !isNodeOfType(method, "MemberExpression") ||
    method.computed ||
    method.optional ||
    getStaticPropertyName(method) !== "then"
  ) {
    return null;
  }
  const request = stripParenExpression(method.object);
  if (
    !isNodeOfType(request, "CallExpression") ||
    request.optional ||
    request.arguments.length !== 1
  ) {
    return null;
  }
  const input = stripParenExpression(request.arguments[0]);
  if (!isNodeOfType(input, "TemplateLiteral") && getStaticStringExpression(input) === null) {
    return null;
  }
  const fetch = stripParenExpression(request.callee);
  return isNodeOfType(fetch, "Identifier") &&
    fetch.name === "fetch" &&
    scopes.isGlobalReference(fetch) &&
    !hasOpaqueProviderAccess(scopes) &&
    isProvenUnmodifiedGlobalNamespaceReference(fetch, "fetch", scopes, undefined, true)
    ? continuation
    : null;
};
