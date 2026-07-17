import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { resolveR3fFreshValue } from "./resolve-r3f-fresh-value.js";

export const resolveR3fUnstableArgsElement = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): string | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (
      symbol?.kind === "const" &&
      symbol.scope.kind !== "module" &&
      symbol.initializer &&
      !visitedSymbolIds.has(symbol.id) &&
      symbol.references.every((reference) => reference.flag === "read") &&
      isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
      symbol.declarationNode.id === symbol.bindingIdentifier
    ) {
      visitedSymbolIds.add(symbol.id);
      return resolveR3fUnstableArgsElement(symbol.initializer, scopes, visitedSymbolIds);
    }
    return null;
  }
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    return (
      resolveR3fUnstableArgsElement(candidate.consequent, scopes, new Set(visitedSymbolIds)) ??
      resolveR3fUnstableArgsElement(candidate.alternate, scopes, new Set(visitedSymbolIds))
    );
  }
  if (isNodeOfType(candidate, "LogicalExpression")) {
    return (
      resolveR3fUnstableArgsElement(candidate.left, scopes, new Set(visitedSymbolIds)) ??
      resolveR3fUnstableArgsElement(candidate.right, scopes, new Set(visitedSymbolIds))
    );
  }
  if (!isNodeOfType(candidate, "ArrayExpression")) return null;
  for (const element of candidate.elements) {
    if (!element) continue;
    if (isNodeOfType(element, "SpreadElement")) {
      const spreadKind = resolveR3fUnstableArgsElement(
        element.argument,
        scopes,
        new Set(visitedSymbolIds),
      );
      if (spreadKind) return spreadKind;
      continue;
    }
    const freshKind = resolveR3fFreshValue(element, scopes);
    if (freshKind) return freshKind;
  }
  return null;
};
