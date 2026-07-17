import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findVariableInitializer } from "./find-variable-initializer.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const resolveCleanupFunctions = (
  expression: EsTreeNode,
  referenceNode: EsTreeNode,
): EsTreeNode[] => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isFunctionLike(unwrappedExpression)) return [unwrappedExpression];
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const binding = findVariableInitializer(referenceNode, unwrappedExpression.name);
    return binding?.initializer && isFunctionLike(stripParenExpression(binding.initializer))
      ? [stripParenExpression(binding.initializer)]
      : [];
  }
  if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
    return [
      ...resolveCleanupFunctions(unwrappedExpression.consequent, referenceNode),
      ...resolveCleanupFunctions(unwrappedExpression.alternate, referenceNode),
    ];
  }
  if (isNodeOfType(unwrappedExpression, "SequenceExpression")) {
    const finalExpression = unwrappedExpression.expressions.at(-1);
    return finalExpression ? resolveCleanupFunctions(finalExpression, referenceNode) : [];
  }
  return [];
};

export const collectReturnedCleanupFunctions = (effectCallback: EsTreeNode): EsTreeNode[] => {
  if (!isFunctionLike(effectCallback)) return [];
  if (!isNodeOfType(effectCallback.body, "BlockStatement")) {
    return resolveCleanupFunctions(effectCallback.body, effectCallback);
  }
  return collectFunctionReturnStatements(effectCallback).flatMap((returnStatement) =>
    returnStatement.argument
      ? resolveCleanupFunctions(returnStatement.argument as EsTreeNode, returnStatement)
      : [],
  );
};
