import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { getApiReferenceProvenance } from "./get-api-reference-provenance.js";
import { isThreeModuleSource } from "./is-three-module-source.js";

export const getThreeConstructorName = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): string | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "NewExpression")) {
    const provenance = getApiReferenceProvenance(candidate.callee, scopes);
    return provenance && isThreeModuleSource(provenance.moduleSource) ? provenance.apiName : null;
  }
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return null;
  }
  visitedSymbolIds.add(symbol.id);
  return getThreeConstructorName(symbol.initializer, scopes, visitedSymbolIds);
};
