import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const OBJECT_INTEGRITY_METHOD_NAMES = new Set(["freeze", "seal", "preventExtensions"]);

export const OBJECT_FREEZE_OR_SEAL_METHOD_NAMES = new Set(["freeze", "seal"]);

export const unwrapObjectIntegrityExpression = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  methodNames = OBJECT_INTEGRITY_METHOD_NAMES,
): EsTreeNode => {
  let expression = stripParenExpression(node);

  while (isNodeOfType(expression, "CallExpression")) {
    const callee = stripParenExpression(expression.callee);
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      callee.computed ||
      !isNodeOfType(callee.object, "Identifier") ||
      callee.object.name !== "Object" ||
      !scopes.isGlobalReference(callee.object) ||
      !isNodeOfType(callee.property, "Identifier") ||
      !methodNames.has(callee.property.name)
    ) {
      break;
    }

    const wrappedExpression = expression.arguments[0];
    if (!wrappedExpression || isNodeOfType(wrappedExpression, "SpreadElement")) break;
    expression = stripParenExpression(wrappedExpression);
  }

  return expression;
};
