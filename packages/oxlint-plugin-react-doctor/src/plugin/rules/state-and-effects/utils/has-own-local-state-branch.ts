import { getRuntimeSymbolReferences } from "../../../utils/get-runtime-symbol-references.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { readStaticBoolean } from "../../../utils/read-static-boolean.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const hasOwnLocalStateBranch = (
  expression: EsTreeNode,
  stateIdentifier: EsTreeNode,
  context: RuleContext,
  guardValues: ReadonlyMap<SymbolDescriptor, boolean>,
  visitedSymbols: ReadonlySet<SymbolDescriptor> = new Set(),
  hasOddNegation = false,
): boolean => {
  const current = stripParenExpression(expression);
  const stateSymbol = context.scopes.symbolFor(stateIdentifier);
  const program = findProgramRoot(expression);
  if (!stateSymbol || !program) return false;
  if (
    !hasCompleteSymbolReferences(stateSymbol, program, context.scopes) ||
    getRuntimeSymbolReferences(stateSymbol).some((reference) => reference.flag !== "read")
  ) {
    return false;
  }
  if (isNodeOfType(current, "Identifier")) {
    const symbol = context.scopes.symbolFor(current);
    if (!symbol) return false;
    if (symbol === stateSymbol) return hasOddNegation;
    const initializer = getDirectConstInitializer(symbol);
    if (
      !initializer ||
      visitedSymbols.has(symbol) ||
      !hasCompleteSymbolReferences(symbol, program, context.scopes) ||
      getRuntimeSymbolReferences(symbol).some((reference) => reference.flag !== "read")
    ) {
      return false;
    }
    return hasOwnLocalStateBranch(
      initializer,
      stateIdentifier,
      context,
      guardValues,
      new Set(visitedSymbols).add(symbol),
      hasOddNegation,
    );
  }
  if (isNodeOfType(current, "UnaryExpression") && current.operator === "!") {
    return hasOwnLocalStateBranch(
      current.argument,
      stateIdentifier,
      context,
      guardValues,
      visitedSymbols,
      !hasOddNegation,
    );
  }
  if (!isNodeOfType(current, "ConditionalExpression")) return false;
  let predicate = stripParenExpression(current.test);
  let isNegated = false;
  while (isNodeOfType(predicate, "UnaryExpression") && predicate.operator === "!") {
    isNegated = !isNegated;
    predicate = stripParenExpression(predicate.argument);
  }
  let predicateValue = readStaticBoolean(predicate);
  if (isNodeOfType(predicate, "Identifier")) {
    const symbol = context.scopes.symbolFor(predicate);
    if (symbol && guardValues.has(symbol)) {
      predicateValue = guardValues.get(symbol) ?? null;
    } else {
      const initializer = symbol && getDirectConstInitializer(symbol);
      if (initializer) predicateValue = readStaticBoolean(initializer);
    }
  }
  if (predicateValue !== null && isNegated) predicateValue = !predicateValue;
  if (predicateValue !== null) {
    return hasOwnLocalStateBranch(
      predicateValue ? current.consequent : current.alternate,
      stateIdentifier,
      context,
      guardValues,
      visitedSymbols,
      hasOddNegation,
    );
  }
  return (
    hasOwnLocalStateBranch(
      current.consequent,
      stateIdentifier,
      context,
      guardValues,
      visitedSymbols,
      hasOddNegation,
    ) &&
    hasOwnLocalStateBranch(
      current.alternate,
      stateIdentifier,
      context,
      guardValues,
      visitedSymbols,
      hasOddNegation,
    )
  );
};
