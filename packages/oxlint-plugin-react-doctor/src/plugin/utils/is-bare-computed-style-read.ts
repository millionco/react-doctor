import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { hasVisibleComputedStyleIntegrity } from "./has-visible-computed-style-integrity.js";
import { isFunctionLike } from "./is-function-like.js";
import { isGlobalBrowserFunctionCall } from "./is-global-browser-function-call.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isBareComputedStyleRead = (
  node: EsTreeNode,
  walkedRoot: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  const callee = stripParenExpression(node.callee);
  if (
    !isNodeOfType(callee, "Identifier") ||
    !isGlobalBrowserFunctionCall(node, "getComputedStyle", scopes) ||
    scopes.referenceFor(callee)?.flag !== "read"
  )
    return false;
  let current: EsTreeNode = node;
  while (current !== walkedRoot) {
    const parent: EsTreeNode | null | undefined = current.parent;
    if (
      !parent ||
      isFunctionLike(parent) ||
      (isNodeOfType(parent, "UnaryExpression") && parent.operator === "void") ||
      (isNodeOfType(parent, "SequenceExpression") && parent.expressions.at(-1) !== current)
    )
      return false;
    current = parent;
  }
  return hasVisibleComputedStyleIntegrity(scopes);
};
