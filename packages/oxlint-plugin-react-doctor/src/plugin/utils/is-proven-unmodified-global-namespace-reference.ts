import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import {
  isProvenGlobalObjectReference,
  isProvenGlobalNamespaceReference,
} from "./is-proven-global-namespace-reference.js";
import { getSymbolMutationInspector } from "./get-symbol-mutation-inspector.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const namespaceMutationByAnalysis = new WeakMap<ScopeAnalysis, Map<string, boolean>>();

const memberIsMutated = (member: EsTreeNode): boolean => {
  const memberRoot = findTransparentExpressionRoot(member);
  const consumer = memberRoot.parent;
  return (
    (isNodeOfType(consumer, "AssignmentExpression") && consumer.left === memberRoot) ||
    (isNodeOfType(consumer, "UpdateExpression") && consumer.argument === memberRoot) ||
    (isNodeOfType(consumer, "UnaryExpression") &&
      consumer.operator === "delete" &&
      consumer.argument === memberRoot)
  );
};

const namespaceHasMemberMutation = (
  namespaceName: string | null,
  scopes: ScopeAnalysis,
  memberName?: string,
  considerEscapes = false,
): boolean => {
  const cacheKey = JSON.stringify([namespaceName, memberName, considerEscapes]);
  const cachedMutation = namespaceMutationByAnalysis.get(scopes)?.get(cacheKey);
  if (cachedMutation !== undefined) return cachedMutation;
  const mutationByNamespace = namespaceMutationByAnalysis.get(scopes) ?? new Map<string, boolean>();
  namespaceMutationByAnalysis.set(scopes, mutationByNamespace);
  const mutations = getSymbolMutationInspector(scopes);
  const matchesNamespace = (expression: EsTreeNode): boolean =>
    namespaceName === null
      ? isProvenGlobalObjectReference(expression, scopes)
      : isProvenGlobalNamespaceReference(expression, namespaceName, scopes);
  const pendingScopes = [scopes.rootScope];
  while (pendingScopes.length > 0) {
    const currentScope = pendingScopes.pop();
    if (!currentScope) break;
    for (const childScope of currentScope.children) pendingScopes.push(childScope);
    for (const reference of currentScope.references) {
      let candidate = findTransparentExpressionRoot(reference.identifier);
      while (true) {
        const target = mutations.getOutermostTarget(candidate);
        const consumer = target.parent;
        const properties = mutations.getMutationPropertyNames(candidate);
        const isMutationCallTarget =
          isNodeOfType(consumer, "CallExpression") && consumer.arguments[0] === target;
        const isBindingWrite =
          considerEscapes &&
          isNodeOfType(target, "Identifier") &&
          ((isNodeOfType(consumer, "AssignmentExpression") && consumer.left === target) ||
            (isNodeOfType(consumer, "UpdateExpression") && consumer.argument === target));
        const isArgumentEscape =
          considerEscapes &&
          isNodeOfType(consumer, "CallExpression") &&
          consumer.arguments.some(
            (argument) =>
              argument === target ||
              (isNodeOfType(argument, "SpreadElement") && argument.argument === target),
          );
        if (
          (isBindingWrite ||
            isArgumentEscape ||
            (isMutationCallTarget &&
              candidate === target &&
              properties !== undefined &&
              (!memberName || properties === null || properties.has(memberName)))) &&
          matchesNamespace(candidate)
        ) {
          mutationByNamespace.set(cacheKey, true);
          return true;
        }
        const member = candidate.parent;
        if (
          !isNodeOfType(member, "MemberExpression") ||
          stripParenExpression(member.object) !== stripParenExpression(candidate)
        )
          break;
        const propertyName = getStaticPropertyName(member);
        if (
          memberIsMutated(member) &&
          (!memberName || propertyName === null || propertyName === memberName) &&
          matchesNamespace(candidate)
        ) {
          mutationByNamespace.set(cacheKey, true);
          return true;
        }
        candidate = findTransparentExpressionRoot(member);
      }
    }
  }
  mutationByNamespace.set(cacheKey, false);
  return false;
};

export const isProvenUnmodifiedGlobalNamespaceReference = (
  expression: EsTreeNode,
  namespaceName: string | null,
  scopes: ScopeAnalysis,
  memberName?: string,
  considerEscapes = false,
): boolean =>
  (namespaceName === null
    ? isProvenGlobalObjectReference(expression, scopes)
    : isProvenGlobalNamespaceReference(expression, namespaceName, scopes)) &&
  !namespaceHasMemberMutation(namespaceName, scopes, memberName, considerEscapes);
