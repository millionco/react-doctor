import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getBooleanCallArgument } from "../../../utils/get-boolean-call-argument.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isUnmodifiedGlobalBooleanCall } from "../../../utils/is-unmodified-global-boolean-call.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const dynamicCodeReferencesByAnalysis = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, boolean>>();

export const getClosedFindResultAliasReads = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): EsTreeNode[] | null => {
  const owner = findEnclosingFunction(symbol.declarationNode);
  if (!owner) return null;
  let ownerReferences = dynamicCodeReferencesByAnalysis.get(scopes);
  if (!ownerReferences) {
    ownerReferences = new WeakMap<EsTreeNode, boolean>();
    dynamicCodeReferencesByAnalysis.set(scopes, ownerReferences);
  }
  let hasDynamicCodeReference = ownerReferences.get(owner);
  if (hasDynamicCodeReference === undefined) {
    hasDynamicCodeReference = false;
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
    ownerReferences.set(owner, hasDynamicCodeReference);
  }
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
    if (
      getBooleanCallArgument(parent) === stripParenExpression(expression) &&
      isUnmodifiedGlobalBooleanCall({ node: parent, scopes })
    ) {
      condition = findTransparentExpressionRoot(parent);
      if (isNodeOfType(condition.parent, "UnaryExpression") && condition.parent.operator === "!") {
        condition = findTransparentExpressionRoot(condition.parent);
      }
    } else if (isNodeOfType(parent, "BinaryExpression")) {
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
