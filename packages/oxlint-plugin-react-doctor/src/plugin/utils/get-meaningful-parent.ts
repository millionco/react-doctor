import type { EsTreeNode } from "./es-tree-node.js";

// oxc-parser surfaces `(...)` as a node kind outside the TSESTree union,
// so it is matched via a `string`-typed constant.
const PARENTHESIZED_EXPRESSION: string = "ParenthesizedExpression";

// The nearest ancestor that is not a grouping parenthesis.
export const getMeaningfulParent = (node: EsTreeNode): EsTreeNode | null => {
  let parent = node.parent ?? null;
  while (parent && parent.type === PARENTHESIZED_EXPRESSION) parent = parent.parent ?? null;
  return parent;
};
