import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { FLOAT_TYPED_ARRAY_CONSTRUCTOR_NAMES } from "../constants.js";

export const isFloatTypedArray = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      symbol.references.some((reference) => reference.flag !== "read")
    ) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    return isFloatTypedArray(symbol.initializer, scopes, visitedSymbolIds);
  }
  if (!isNodeOfType(candidate, "NewExpression")) return false;
  const callee = stripParenExpression(candidate.callee);
  return (
    isNodeOfType(callee, "Identifier") &&
    FLOAT_TYPED_ARRAY_CONSTRUCTOR_NAMES.has(callee.name) &&
    scopes.isGlobalReference(callee)
  );
};
