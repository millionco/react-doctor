import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { hasPossibleStaticPropertyWriteBefore } from "./has-static-property-write-before.js";
import { hasSymbolWriteBefore } from "./has-symbol-write-before.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const resolveStableOptionsObject = (
  expression: EsTreeNode,
  observedPropertyNames: ReadonlyArray<string>,
  scopes: ScopeAnalysis,
  referenceNode: EsTreeNode = expression,
  visitedSymbolIds = new Set<number>(),
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "ObjectExpression")) return unwrappedExpression;
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const symbol = scopes.symbolFor(unwrappedExpression);
  if (
    !symbol?.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    hasSymbolWriteBefore(symbol, referenceNode, scopes) ||
    observedPropertyNames.some((propertyName) =>
      hasPossibleStaticPropertyWriteBefore(
        unwrappedExpression,
        propertyName,
        referenceNode,
        scopes,
      ),
    )
  ) {
    return null;
  }
  visitedSymbolIds.add(symbol.id);
  return resolveStableOptionsObject(
    symbol.initializer,
    observedPropertyNames,
    scopes,
    referenceNode,
    visitedSymbolIds,
  );
};
