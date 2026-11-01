import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getBooleanCallArgument } from "../../../utils/get-boolean-call-argument.js";
import { isUnmodifiedGlobalBooleanCall } from "../../../utils/is-unmodified-global-boolean-call.js";
import { isImportedNextNavigationExit } from "../../../utils/is-imported-next-navigation-exit.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isPresenceProvenBeforeNode } from "../../../utils/is-presence-proven-before-node.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const isFindResultAliasGuarded = (
  access: EsTreeNode,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const readsAlias = (candidate: EsTreeNode): boolean => {
    const expression = stripParenExpression(candidate);
    return isNodeOfType(expression, "Identifier") && scopes.symbolFor(expression)?.id === symbol.id;
  };
  const isUndefined = (candidate: EsTreeNode): boolean => {
    const expression = stripParenExpression(candidate);
    return (
      isNodeOfType(expression, "Identifier") &&
      expression.name === "undefined" &&
      scopes.isGlobalReference(expression)
    );
  };
  const provesPresence = (candidate: EsTreeNode): boolean => {
    const expression = stripParenExpression(candidate);
    const booleanArgument = getBooleanCallArgument(expression);
    if (booleanArgument) {
      return (
        readsAlias(booleanArgument) && isUnmodifiedGlobalBooleanCall({ node: expression, scopes })
      );
    }
    if (isNodeOfType(expression, "LogicalExpression")) {
      if (expression.operator === "&&")
        return provesPresence(expression.left) || provesPresence(expression.right);
      if (expression.operator === "||")
        return provesPresence(expression.left) && provesPresence(expression.right);
      return false;
    }
    if (readsAlias(expression)) {
      const originalTest = findTransparentExpressionRoot(expression).parent;
      if (originalTest && isNodeOfType(originalTest, "BinaryExpression")) {
        const other =
          stripParenExpression(originalTest.left) === expression
            ? originalTest.right
            : originalTest.left;
        return (
          ((originalTest.operator === "===" || originalTest.operator === "==") &&
            isUndefined(other)) ||
          (originalTest.operator === "==" && isNodeOfType(other, "Literal") && other.value === null)
        );
      }
      return true;
    }
    if (!isNodeOfType(expression, "BinaryExpression")) return false;
    const pairs: Array<[EsTreeNode, EsTreeNode]> = [
      [expression.left, expression.right],
      [expression.right, expression.left],
    ];
    return pairs.some(
      ([value, comparison]) =>
        readsAlias(value) &&
        (((expression.operator === "!==" || expression.operator === "!=") &&
          isUndefined(comparison)) ||
          (expression.operator === "!=" &&
            isNodeOfType(comparison, "Literal") &&
            comparison.value === null)),
    );
  };
  return isPresenceProvenBeforeNode(access, provesPresence, undefined, (statement) =>
    isImportedNextNavigationExit({ statement, scopes }),
  );
};
