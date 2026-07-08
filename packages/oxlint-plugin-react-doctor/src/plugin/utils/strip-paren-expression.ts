import type { EsTreeNode } from "./es-tree-node.js";

// Mirrors `Expression::without_parentheses().get_inner_expression()` —
// peels TS type assertions and parens off so visitor logic operates on
// the semantic expression. ESTree from oxc-parser surfaces those wrappers
// as `TSAsExpression`, `TSSatisfiesExpression`, `TSTypeAssertion`,
// `TSNonNullExpression`, etc.; strip them all. Every member carries the
// inner node on `.expression`, so both the downward strip here and the
// upward climb in `findTransparentExpressionRoot` share this set.
export const TRANSPARENT_EXPRESSION_WRAPPER_TYPES: ReadonlySet<string> = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
  "TSNonNullExpression",
  "TSInstantiationExpression",
  "ChainExpression",
]);

export const stripParenExpression = (node: EsTreeNode): EsTreeNode => {
  let current = node;
  while (
    TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(current.type) &&
    "expression" in current &&
    current.expression
  ) {
    current = current.expression as EsTreeNode;
  }
  return current;
};
