import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { getApiReferenceProvenance } from "./get-api-reference-provenance.js";
import { isThreeModuleSource } from "./is-three-module-source.js";

export interface ResolvedThreeConstructor {
  constructorName: string;
  node: EsTreeNodeOfType<"NewExpression">;
}

export const resolveThreeConstructor = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): ResolvedThreeConstructor | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "NewExpression")) {
    const provenance = getApiReferenceProvenance(candidate.callee, scopes);
    return provenance && isThreeModuleSource(provenance.moduleSource)
      ? { constructorName: provenance.apiName, node: candidate }
      : null;
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
  return resolveThreeConstructor(symbol.initializer, scopes, visitedSymbolIds);
};
