import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

export const getClosedFindResultAliasReads = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): EsTreeNode[] | null => {
  const owner = findEnclosingFunction(symbol.declarationNode);
  if (!owner) return null;
  let hasDynamicCodeReference = false;
  walkAst(owner, (node) => {
    if (
      isNodeOfType(node, "Identifier") &&
      node.name === "eval" &&
      scopes.isGlobalReference(node)
    ) {
      hasDynamicCodeReference = true;
      return false;
    }
  });
  if (hasDynamicCodeReference) return null;
  const reads: EsTreeNode[] = [];
  for (const reference of symbol.references) {
    const identifier = reference.identifier;
    if (
      reference.flag !== "read" ||
      isWithinAssignmentTarget(identifier) ||
      findEnclosingFunction(identifier) !== owner ||
      symbol.declarationNode.range[1] > identifier.range[0]
    )
      return null;
    const expression = findTransparentExpressionRoot(identifier);
    const parent = expression.parent;
    if (!parent) return null;
    for (
      let wrapper = identifier.parent;
      wrapper && wrapper !== expression.parent;
      wrapper = wrapper.parent
    ) {
      if (isNodeOfType(wrapper, "TSNonNullExpression")) return null;
    }
    if (isNodeOfType(parent, "MemberExpression") && parent.object === expression) {
      if (parent.optional || isWithinAssignmentTarget(parent)) return null;
      reads.push(parent);
      continue;
    }
    let condition = expression;
    if (isNodeOfType(parent, "BinaryExpression")) {
      const other = stripParenExpression(parent.left === expression ? parent.right : parent.left);
      if (
        !["===", "!==", "==", "!="].includes(parent.operator) ||
        (!(isNodeOfType(other, "Literal") && other.value === null) &&
          !(isNodeOfType(other, "Identifier") && other.name === "undefined"))
      )
        return null;
      condition = findTransparentExpressionRoot(parent);
    } else if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") {
      condition = findTransparentExpressionRoot(parent);
    }
    let consumer = condition.parent;
    while (
      consumer &&
      isNodeOfType(consumer, "LogicalExpression") &&
      (consumer.operator === "&&" || consumer.operator === "||")
    ) {
      if (consumer.operator === "||" && isNodeOfType(parent, "BinaryExpression")) return null;
      condition = findTransparentExpressionRoot(consumer);
      consumer = condition.parent;
    }
    if (
      consumer &&
      ((isNodeOfType(consumer, "IfStatement") && consumer.test === condition) ||
        (isNodeOfType(consumer, "ConditionalExpression") && consumer.test === condition) ||
        (isNodeOfType(condition, "LogicalExpression") &&
          (isNodeOfType(consumer, "JSXExpressionContainer") ||
            isNodeOfType(consumer, "ReturnStatement") ||
            isNodeOfType(consumer, "ExpressionStatement"))))
    )
      continue;
    return null;
  }
  return reads;
};
