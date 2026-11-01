import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "./has-static-property-write-before.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenPromiseExpression } from "./is-proven-promise-expression.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "./is-proven-unmodified-global-namespace-reference.js";
import {
  stripParenExpression,
  TRANSPARENT_EXPRESSION_WRAPPER_TYPES,
} from "./strip-paren-expression.js";

export const getDeferredEffectCallbackCall = (
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (!isFunctionLike(callback) || callback.generator) return null;
  let container = callback.parent;
  while (container && TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(container.type)) {
    container = container.parent;
  }
  if (!isNodeOfType(container, "CallExpression")) return null;
  const callbackIndex = container.arguments.findIndex(
    (argument) => stripParenExpression(argument) === callback,
  );
  if (callbackIndex < 0) return null;
  const callee = stripParenExpression(container.callee);
  if (isNodeOfType(callee, "Identifier")) {
    return callee.name === "queueMicrotask" &&
      callbackIndex === 0 &&
      scopes.isGlobalReference(callee) &&
      isProvenUnmodifiedGlobalNamespaceReference(callee, "queueMicrotask", scopes, undefined, true)
      ? container
      : null;
  }
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const methodName = getStaticPropertyName(callee);
  const isContinuationArgument =
    (methodName === "then" && (callbackIndex === 0 || callbackIndex === 1)) ||
    ((methodName === "catch" || methodName === "finally") && callbackIndex === 0);
  return isContinuationArgument &&
    methodName &&
    !hasPossibleStaticPropertyMutationOrEscape(
      stripParenExpression(callee.object),
      methodName,
      scopes,
    ) &&
    isProvenPromiseExpression(callee.object, scopes, {
      allowAsyncFunctions: false,
      requireUnmodifiedGlobalPromise: true,
    })
    ? container
    : null;
};
