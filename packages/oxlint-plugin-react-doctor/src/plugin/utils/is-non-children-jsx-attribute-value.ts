import type { EsTreeNode } from "./es-tree-node.js";
import { getJsxAttributeName } from "./get-jsx-attribute-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Ascends through wrappers that pass their inner value straight through to a JSX
// expression container without changing whether it lands in a prop or in
// `children`: optional chaining, `&&`/`||`/`??`, ternary branches, and TS
// `as` / `satisfies` / `!`. So `items={cond && xs.map(...)}` is treated the same
// as the bare `items={xs.map(...)}`. (Parentheses aren't a distinct AST node, so
// they're already transparent.) Stops at the first ancestor that isn't such a
// wrapper (or at a ternary `test`, where the value isn't yielded).
const ascendThroughJsxValueWrappers = (node: EsTreeNode): EsTreeNode => {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    const passesValueThrough =
      isNodeOfType(parent, "ChainExpression") ||
      isNodeOfType(parent, "TSAsExpression") ||
      isNodeOfType(parent, "TSSatisfiesExpression") ||
      isNodeOfType(parent, "TSNonNullExpression") ||
      isNodeOfType(parent, "LogicalExpression") ||
      (isNodeOfType(parent, "ConditionalExpression") && parent.test !== current);
    if (!passesValueThrough) break;
    current = parent;
  }
  return current;
};

// True when `node` is the value of a JSX attribute other than `children`
// (e.g. the array in `<Menu items={[...]} />`). React's dev-mode key
// validation only iterates `props.children`, so an element collection handed
// to any other prop is the receiving component's responsibility to key —
// flagging it at the producer site is a false positive. The `children`
// attribute is excluded because `children={[...]}` IS `props.children`, which
// React does validate.
export const isNonChildrenJsxAttributeValue = (node: EsTreeNode): boolean => {
  const container = ascendThroughJsxValueWrappers(node).parent;
  if (!container || !isNodeOfType(container, "JSXExpressionContainer")) return false;
  const attribute = container.parent;
  if (!attribute || !isNodeOfType(attribute, "JSXAttribute")) return false;
  return getJsxAttributeName(attribute.name) !== "children";
};
