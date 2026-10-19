import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { createMethodMutationAnalysis } from "../../../utils/has-proven-method-mutation.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import {
  isProvenGlobalObjectReference,
  isProvenGlobalNamespaceReference,
} from "../../../utils/is-proven-global-namespace-reference.js";
import { resolveExpressionKey } from "../../../utils/resolve-expression-key.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isImmediateIifeNativeGlobalReference } from "./is-immediate-iife-native-global-reference.js";
import { IMMEDIATE_IIFE_PROMISE_METHOD_NAMES } from "./immediate-iife-fetch/constants.js";

export interface ImmediateIifeFetchProviderCheck {
  (fetchCall: EsTreeNodeOfType<"CallExpression">, chain: EsTreeNode): boolean;
}

export const createImmediateIifeFetchProviderCheck = (
  context: RuleContext,
): ImmediateIifeFetchProviderCheck => {
  const mutationAnalysis = createMethodMutationAnalysis(context);
  const globalObjectsByIdentity = new Map<string, EsTreeNode>();
  const promisePrototypesByIdentity = new Map<string, EsTreeNode>();
  let didIndexProviders = false;
  let hasUnsupportedProvider = false;
  return (fetchCall, chain) => {
    if (!didIndexProviders) {
      const providerScopes: ScopeAnalysis = {
        ...context.scopes,
        isGlobalReference: (identifier) =>
          context.scopes.isGlobalReference(identifier) ||
          (isNodeOfType(identifier, "Identifier") &&
            (identifier.name === "globalThis" ||
              identifier.name === "window" ||
              identifier.name === "self" ||
              identifier.name === "global" ||
              identifier.name === "Promise") &&
            isImmediateIifeNativeGlobalReference(identifier, identifier.name, context.scopes)),
      };

      walkAst(context.scopes.rootScope.node, (node) => {
        if (isNodeOfType(node, "TSParameterProperty")) {
          hasUnsupportedProvider = true;
          return false;
        }
        mutationAnalysis.record(node);
        if (
          isNodeOfType(node, "MemberExpression") &&
          node.computed &&
          getStaticPropertyName(node) === null &&
          isWithinAssignmentTarget(node)
        ) {
          const receiver = stripParenExpression(node.object);
          if (
            isProvenGlobalObjectReference(receiver, providerScopes) ||
            isProvenGlobalNamespaceReference(receiver, "Promise", providerScopes) ||
            (isNodeOfType(receiver, "MemberExpression") &&
              getStaticPropertyName(receiver) === "prototype" &&
              isProvenGlobalNamespaceReference(receiver.object, "Promise", providerScopes))
          ) {
            hasUnsupportedProvider = true;
          }
        }
        const identity = resolveExpressionKey(node, context);
        if (!identity) return;
        if (isProvenGlobalObjectReference(node, providerScopes)) {
          globalObjectsByIdentity.set(identity, node);
        }
        if (
          isNodeOfType(node, "MemberExpression") &&
          getStaticPropertyName(node) === "prototype" &&
          (isProvenGlobalNamespaceReference(node.object, "Promise", providerScopes) ||
            isImmediateIifeNativeGlobalReference(
              stripParenExpression(node.object),
              "Promise",
              context.scopes,
            ))
        ) {
          promisePrototypesByIdentity.set(identity, node);
        }
      });
      didIndexProviders = true;
    }
    if (
      hasUnsupportedProvider ||
      mutationAnalysis.hasProvenMutation(fetchCall.callee, "", fetchCall)
    )
      return false;
    for (const globalObject of globalObjectsByIdentity.values()) {
      if (mutationAnalysis.hasProvenMutation(globalObject, "fetch", fetchCall)) return false;
    }
    for (const promisePrototype of promisePrototypesByIdentity.values()) {
      for (const methodName of IMMEDIATE_IIFE_PROMISE_METHOD_NAMES) {
        if (mutationAnalysis.hasProvenMutation(promisePrototype, methodName, chain)) return false;
      }
    }
    return true;
  };
};
