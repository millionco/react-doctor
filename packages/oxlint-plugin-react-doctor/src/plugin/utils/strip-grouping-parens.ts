import type { EsTreeNode } from "./es-tree-node.js";

// oxc-parser surfaces `(...)` as a `ParenthesizedExpression`, a node kind
// outside the TSESTree union, so it is matched by string here.
export const PARENTHESIZED_EXPRESSION_TYPE: string = "ParenthesizedExpression";

// Peels ONLY grouping parentheses, leaving TS assertion (`as` / `satisfies`
// / `!`) and optional-chaining wrappers intact — unlike
// `stripParenExpression`, which also strips those. Needed by rules that
// inspect the assertion nodes themselves (no-double-cast-through-unknown)
// or must decide whether an expression is the DIRECT argument/operand of a
// consuming node while ignoring redundant parentheses.
export const stripGroupingParens = (node: EsTreeNode): EsTreeNode => {
  let current = node;
  while (
    current.type === PARENTHESIZED_EXPRESSION_TYPE &&
    "expression" in current &&
    current.expression
  ) {
    current = current.expression as EsTreeNode;
  }
  return current;
};
