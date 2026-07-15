import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

export const expressionReadsPatternBinding = (
  expression: EsTreeNode,
  patterns: ReadonlyArray<EsTreeNode>,
  scopes: ScopeAnalysis,
): boolean => {
  const bindingSymbolIds = new Set<number>();
  for (const pattern of patterns) {
    walkAst(pattern, (child: EsTreeNode) => {
      if (!isNodeOfType(child, "Identifier")) return;
      const symbol = scopes.symbolFor(child);
      if (symbol?.bindingIdentifier === child) bindingSymbolIds.add(symbol.id);
    });
  }

  let didReadBinding = false;
  walkAst(expression, (child: EsTreeNode) => {
    if (didReadBinding || !isNodeOfType(child, "Identifier")) return;
    const reference = scopes.referenceFor(child);
    if (
      reference?.flag !== "write" &&
      reference?.resolvedSymbol &&
      bindingSymbolIds.has(reference.resolvedSymbol.id)
    ) {
      didReadBinding = true;
    }
  });
  return didReadBinding;
};
