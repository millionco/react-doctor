import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNullishExpression } from "./is-nullish-expression.js";

// True when a JSX child renders actual content. The JSX transform drops
// whitespace-with-newline text (the auto-formatted line break between
// tags), `{/* comment */}` (a `JSXEmptyExpression`) emits no child, and
// `{undefined}` / `{null}` / `{void 0}` are nullish — none count as
// runtime children. A bare whitespace string WITHOUT a newline
// (`<img> </img>`) is preserved as a child, matching the upstream OXC ports.
export const isMeaningfulJsxChild = (child: EsTreeNode): boolean => {
  if (isNodeOfType(child, "JSXText")) {
    if (child.value.trim().length > 0) return true;
    return !child.value.includes("\n");
  }
  if (isNodeOfType(child, "JSXExpressionContainer")) {
    const expression = child.expression;
    if (!expression || isNodeOfType(expression, "JSXEmptyExpression")) return false;
    if (isNullishExpression(expression)) return false;
    return true;
  }
  return true;
};
