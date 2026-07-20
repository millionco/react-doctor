import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findVariableInitializer } from "./find-variable-initializer.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const resolveCleanupFunctions = (
  expression: EsTreeNode,
  referenceNode: EsTreeNode,
  scopes?: ScopeAnalysis,
): EsTreeNode[] => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isFunctionLike(unwrappedExpression)) return [unwrappedExpression];
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    if (scopes) {
      const symbol = resolveConstIdentifierAlias(unwrappedExpression, scopes);
      if (
        !symbol ||
        (symbol.kind !== "const" && symbol.kind !== "function") ||
        symbol.references.some((reference) => reference.flag !== "read")
      ) {
        return [];
      }
      if (isFunctionLike(symbol.declarationNode)) return [symbol.declarationNode];
      return symbol.initializer && isFunctionLike(stripParenExpression(symbol.initializer))
        ? [stripParenExpression(symbol.initializer)]
        : [];
    }
    const binding = findVariableInitializer(referenceNode, unwrappedExpression.name);
    return binding?.initializer && isFunctionLike(stripParenExpression(binding.initializer))
      ? [stripParenExpression(binding.initializer)]
      : [];
  }
  if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
    return [
      ...resolveCleanupFunctions(unwrappedExpression.consequent, referenceNode, scopes),
      ...resolveCleanupFunctions(unwrappedExpression.alternate, referenceNode, scopes),
    ];
  }
  if (isNodeOfType(unwrappedExpression, "SequenceExpression")) {
    const finalExpression = unwrappedExpression.expressions.at(-1);
    return finalExpression ? resolveCleanupFunctions(finalExpression, referenceNode, scopes) : [];
  }
  return [];
};

export const collectReturnedCleanupFunctions = (
  effectCallback: EsTreeNode,
  scopes?: ScopeAnalysis,
): EsTreeNode[] => {
  if (!isFunctionLike(effectCallback)) return [];
  if (!isNodeOfType(effectCallback.body, "BlockStatement")) {
    return resolveCleanupFunctions(effectCallback.body, effectCallback, scopes);
  }
  return collectFunctionReturnStatements(effectCallback).flatMap((returnStatement) =>
    returnStatement.argument
      ? resolveCleanupFunctions(returnStatement.argument as EsTreeNode, returnStatement, scopes)
      : [],
  );
};
