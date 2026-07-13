import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { functionReturnsMatchingExpression } from "./function-returns-matching-expression.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const functionReturnsPropsChildren = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isFunctionLike(functionNode) || functionNode.params.length === 0) return false;
  return functionReturnsMatchingExpression(functionNode, scopes, (expression) => {
    const candidate = stripParenExpression(expression);
    if (isNodeOfType(candidate, "Identifier")) {
      const symbol = scopes.symbolFor(candidate);
      return Boolean(symbol?.kind === "parameter" && symbol.name === "children");
    }
    if (!isNodeOfType(candidate, "MemberExpression")) return false;
    if (getStaticPropertyName(candidate) !== "children") return false;
    const receiver = stripParenExpression(candidate.object);
    if (!isNodeOfType(receiver, "Identifier")) return false;
    return scopes.symbolFor(receiver)?.kind === "parameter";
  });
};
