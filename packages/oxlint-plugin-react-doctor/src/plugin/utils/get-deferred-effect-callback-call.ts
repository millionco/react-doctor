import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasPossibleStaticPropertyWrite } from "./has-static-property-write-before.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenPromiseExpression } from "./is-proven-promise-expression.js";
import { isProvenGlobalNamespaceReference } from "./is-proven-global-namespace-reference.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import {
  stripParenExpression,
  TRANSPARENT_EXPRESSION_WRAPPER_TYPES,
} from "./strip-paren-expression.js";

const globalNamespaceWritesByAnalysis = new WeakMap<ScopeAnalysis, Map<string, boolean>>();

const hasGlobalNamespaceWrite = (namespaceName: string, scopes: ScopeAnalysis): boolean => {
  const cachedWrites = globalNamespaceWritesByAnalysis.get(scopes);
  const cachedWrite = cachedWrites?.get(namespaceName);
  if (cachedWrite !== undefined) return cachedWrite;
  const namespaceWrites = cachedWrites ?? new Map<string, boolean>();
  globalNamespaceWritesByAnalysis.set(scopes, namespaceWrites);
  const pendingScopes = [scopes.rootScope];
  while (pendingScopes.length > 0) {
    const currentScope = pendingScopes.pop();
    if (!currentScope) break;
    if (
      currentScope.references.some((reference) => {
        let candidate = findTransparentExpressionRoot(reference.identifier);
        while (true) {
          if (
            isProvenGlobalNamespaceReference(candidate, namespaceName, scopes) &&
            isWithinAssignmentTarget(candidate)
          ) {
            return true;
          }
          const parent = candidate.parent;
          if (!isNodeOfType(parent, "MemberExpression") || parent.object !== candidate) {
            return false;
          }
          candidate = findTransparentExpressionRoot(parent);
        }
      })
    ) {
      namespaceWrites.set(namespaceName, true);
      return true;
    }
    pendingScopes.push(...currentScope.children);
  }
  namespaceWrites.set(namespaceName, false);
  return false;
};

export const getDeferredEffectCallbackCall = (
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"CallExpression"> | null => {
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
      !hasGlobalNamespaceWrite("queueMicrotask", scopes)
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
    !hasPossibleStaticPropertyWrite(stripParenExpression(callee.object), methodName, scopes) &&
    !hasGlobalNamespaceWrite("Promise", scopes) &&
    isProvenPromiseExpression(callee.object, scopes, { allowAsyncFunctions: false })
    ? container
    : null;
};
