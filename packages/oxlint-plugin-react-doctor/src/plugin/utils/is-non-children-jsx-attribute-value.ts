import type { EsTreeNode } from "./es-tree-node.js";
import { getJsxAttributeName } from "./get-jsx-attribute-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

// True when `node` is the value of a JSX attribute other than `children`
// (e.g. the array in `<Menu items={[...]} />`). React's dev-mode key
// validation only iterates `props.children`, so an element collection handed
// to any other prop is the receiving component's responsibility to key —
// flagging it at the producer site is a false positive. The `children`
// attribute is excluded because `children={[...]}` IS `props.children`, which
// React does validate. A `ChainExpression` wrapper (`items={xs?.map(...)}`) is
// walked through so the optional-chained form is treated like the plain one.
export const isNonChildrenJsxAttributeValue = (node: EsTreeNode): boolean => {
  const container =
    node.parent && isNodeOfType(node.parent, "ChainExpression") ? node.parent.parent : node.parent;
  if (!container || !isNodeOfType(container, "JSXExpressionContainer")) return false;
  const attribute = container.parent;
  if (!attribute || !isNodeOfType(attribute, "JSXAttribute")) return false;
  return getJsxAttributeName(attribute.name) !== "children";
};
