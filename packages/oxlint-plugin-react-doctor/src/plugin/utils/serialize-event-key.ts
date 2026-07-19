import { isNodeOfType } from "./is-node-of-type.js";
import { serializeReferenceKey } from "./serialize-reference-key.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";

export const serializeEventKey = (
  node: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
): string | null => {
  if (!node) return null;
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
    return `literal:${expression.value}`;
  }
  if (isNodeOfType(expression, "TemplateLiteral") && expression.expressions.length === 0) {
    return `literal:${expression.quasis[0]?.value.cooked ?? ""}`;
  }
  const referenceKey = serializeReferenceKey({ node: expression, scopes });
  return referenceKey ? `reference:${referenceKey}` : null;
};
