import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "./is-proven-global-namespace-reference.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const namespaceAliasIsMutated = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  const hasMemberMutation = symbol.references.some((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const member = referenceRoot.parent;
    if (
      !member ||
      !isNodeOfType(member, "MemberExpression") ||
      stripParenExpression(member.object) !== stripParenExpression(referenceRoot)
    ) {
      return false;
    }
    const memberRoot = findTransparentExpressionRoot(member);
    const consumer = memberRoot.parent;
    return (
      (isNodeOfType(consumer, "AssignmentExpression") && consumer.left === memberRoot) ||
      (isNodeOfType(consumer, "UpdateExpression") && consumer.argument === memberRoot) ||
      (isNodeOfType(consumer, "UnaryExpression") &&
        consumer.operator === "delete" &&
        consumer.argument === memberRoot)
    );
  });
  if (hasMemberMutation) return true;
  if (symbol.kind !== "const" || !symbol.initializer) return false;
  const nextVisitedSymbolIds = new Set(visitedSymbolIds);
  nextVisitedSymbolIds.add(symbol.id);
  return namespaceAliasIsMutated(symbol.initializer, scopes, nextVisitedSymbolIds);
};

export const isProvenUnmodifiedGlobalNamespaceReference = (
  expression: EsTreeNode,
  namespaceName: string,
  scopes: ScopeAnalysis,
): boolean =>
  isProvenGlobalNamespaceReference(expression, namespaceName, scopes) &&
  !namespaceAliasIsMutated(expression, scopes);
