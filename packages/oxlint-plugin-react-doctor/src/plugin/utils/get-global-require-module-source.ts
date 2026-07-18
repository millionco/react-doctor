import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const getGlobalRequireModuleSource = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "MemberExpression")) {
    return getGlobalRequireModuleSource(candidate.object, scopes);
  }
  if (
    !isNodeOfType(candidate, "CallExpression") ||
    !isNodeOfType(candidate.callee, "Identifier") ||
    candidate.callee.name !== "require" ||
    !scopes.isGlobalReference(candidate.callee)
  ) {
    return null;
  }
  const moduleSpecifier = candidate.arguments[0];
  return moduleSpecifier &&
    isNodeOfType(moduleSpecifier, "Literal") &&
    typeof moduleSpecifier.value === "string"
    ? moduleSpecifier.value
    : null;
};
