import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isPresenceProvenBeforeNode } from "../../../utils/is-presence-proven-before-node.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const isSplitAliasPartGuarded = (
  access: EsTreeNode,
  symbol: SymbolDescriptor,
  partIndex: number,
  scopes: ScopeAnalysis,
): boolean => {
  const readsAlias = (candidate: EsTreeNode): boolean => {
    const expression = stripParenExpression(candidate);
    return isNodeOfType(expression, "Identifier") && scopes.symbolFor(expression)?.id === symbol.id;
  };
  const readsPart = (candidate: EsTreeNode): boolean => {
    const expression = stripParenExpression(candidate);
    return (
      isNodeOfType(expression, "MemberExpression") &&
      expression.computed &&
      readsAlias(expression.object) &&
      isNodeOfType(expression.property, "Literal") &&
      expression.property.value === partIndex
    );
  };
  const isUndefined = (candidate: EsTreeNode): boolean => {
    const expression = stripParenExpression(candidate);
    return (
      (isNodeOfType(expression, "Identifier") &&
        expression.name === "undefined" &&
        scopes.isGlobalReference(expression)) ||
      (isNodeOfType(expression, "UnaryExpression") && expression.operator === "void")
    );
  };
  const provesPart = (candidate: EsTreeNode): boolean => {
    const expression = stripParenExpression(candidate);
    if (isNodeOfType(expression, "LogicalExpression")) {
      if (expression.operator === "&&")
        return provesPart(expression.left) || provesPart(expression.right);
      if (expression.operator === "||")
        return provesPart(expression.left) && provesPart(expression.right);
      return false;
    }
    if (readsPart(expression)) {
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
    return pairs.some(([value, threshold]) => {
      if (readsPart(value)) {
        return (
          ((expression.operator === "!==" || expression.operator === "!=") &&
            isUndefined(threshold)) ||
          (expression.operator === "!=" &&
            isNodeOfType(threshold, "Literal") &&
            threshold.value === null)
        );
      }
      return false;
    });
  };
  return isPresenceProvenBeforeNode(access, provesPart);
};
