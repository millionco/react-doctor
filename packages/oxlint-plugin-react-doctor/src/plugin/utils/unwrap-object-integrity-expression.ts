import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const OBJECT_INTEGRITY_METHOD_NAMES = new Set(["freeze", "seal", "preventExtensions"]);

export const OBJECT_FREEZE_OR_SEAL_METHOD_NAMES = new Set(["freeze", "seal"]);

export const getObjectIntegrityMethodName = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  methodNames = OBJECT_INTEGRITY_METHOD_NAMES,
): string | null => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "CallExpression")) return null;
  const callee = stripParenExpression(expression.callee);
  const receiver = isNodeOfType(callee, "MemberExpression")
    ? stripParenExpression(callee.object)
    : callee;
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(receiver, "Identifier") ||
    receiver.name !== "Object" ||
    !scopes.isGlobalReference(receiver) ||
    !isNodeOfType(callee.property, "Identifier") ||
    !methodNames.has(callee.property.name)
  ) {
    return null;
  }
  return callee.property.name;
};

export const unwrapObjectIntegrityExpression = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  methodNames = OBJECT_INTEGRITY_METHOD_NAMES,
): EsTreeNode => {
  let expression = stripParenExpression(node);

  while (isNodeOfType(expression, "CallExpression")) {
    if (!getObjectIntegrityMethodName(expression, scopes, methodNames)) break;

    const wrappedExpression = expression.arguments[0];
    if (!wrappedExpression || isNodeOfType(wrappedExpression, "SpreadElement")) break;
    expression = stripParenExpression(wrappedExpression);
  }

  return expression;
};
