import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import {
  isProvenGlobalObjectReference,
  isProvenGlobalNamespaceReference,
} from "./is-proven-global-namespace-reference.js";
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
): boolean => {
  const cacheKey = JSON.stringify([namespaceName, memberName]);
  const cachedMutation = namespaceMutationByAnalysis.get(scopes)?.get(cacheKey);
  if (cachedMutation !== undefined) return cachedMutation;
  const mutationByNamespace = namespaceMutationByAnalysis.get(scopes) ?? new Map<string, boolean>();
  namespaceMutationByAnalysis.set(scopes, mutationByNamespace);
  const pendingScopes = [scopes.rootScope];
  while (pendingScopes.length > 0) {
    const currentScope = pendingScopes.pop();
    if (!currentScope) break;
    for (const childScope of currentScope.children) pendingScopes.push(childScope);
    for (const reference of currentScope.references) {
      let candidate = findTransparentExpressionRoot(reference.identifier);
      while (candidate.parent && isNodeOfType(candidate.parent, "MemberExpression")) {
        const member = candidate.parent;
        if (stripParenExpression(member.object) !== stripParenExpression(candidate)) break;
        if (
          memberIsMutated(member) &&
          (!memberName || getStaticPropertyName(member) === memberName) &&
          (namespaceName === null
            ? isProvenGlobalObjectReference(candidate, scopes)
            : isProvenGlobalNamespaceReference(candidate, namespaceName, scopes))
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
): boolean =>
  (namespaceName === null
    ? isProvenGlobalObjectReference(expression, scopes)
    : isProvenGlobalNamespaceReference(expression, namespaceName, scopes)) &&
  !namespaceHasMemberMutation(namespaceName, scopes, memberName);
