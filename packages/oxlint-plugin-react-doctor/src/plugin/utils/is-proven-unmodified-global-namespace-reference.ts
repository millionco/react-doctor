import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "./is-proven-global-namespace-reference.js";
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
  namespaceName: string,
  scopes: ScopeAnalysis,
  memberName?: string,
): boolean => {
  const cacheKey = memberName ? `${namespaceName}.${memberName}` : namespaceName;
  const cachedMutation = namespaceMutationByAnalysis.get(scopes)?.get(cacheKey);
  if (cachedMutation !== undefined) return cachedMutation;
  const mutationByNamespace = namespaceMutationByAnalysis.get(scopes) ?? new Map<string, boolean>();
  namespaceMutationByAnalysis.set(scopes, mutationByNamespace);
  const pendingScopes = [scopes.rootScope];
  while (pendingScopes.length > 0) {
    const currentScope = pendingScopes.pop();
    if (!currentScope) break;
    pendingScopes.push(...currentScope.children);
    for (const reference of currentScope.references) {
      let candidate = findTransparentExpressionRoot(reference.identifier);
      while (candidate.parent && isNodeOfType(candidate.parent, "MemberExpression")) {
        const member = candidate.parent;
        if (stripParenExpression(member.object) !== stripParenExpression(candidate)) break;
        if (
          isProvenGlobalNamespaceReference(candidate, namespaceName, scopes) &&
          (!memberName || getStaticPropertyName(member) === memberName) &&
          memberIsMutated(member)
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
  namespaceName: string,
  scopes: ScopeAnalysis,
  memberName?: string,
): boolean =>
  isProvenGlobalNamespaceReference(expression, namespaceName, scopes) &&
  !namespaceHasMemberMutation(namespaceName, scopes, memberName);
