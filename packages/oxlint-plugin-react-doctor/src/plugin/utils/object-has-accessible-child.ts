import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { hasJsxPropIgnoreCase } from "./has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "./has-jsx-spread-attribute.js";
import { isHiddenFromScreenReader } from "./is-hidden-from-screen-reader.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Returns true when the JSX element has a non-hidden text or
// non-hidden JSX-element child, OR sets `dangerouslySetInnerHTML` /
// has explicit `children` prop. Mirrors
// oxc_linter::utils::react::object_has_accessible_child.
export const objectHasAccessibleChild = (
  jsxElement: EsTreeNodeOfType<"JSXElement">,
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  for (const child of jsxElement.children) {
    if (isNodeOfType(child as EsTreeNode, "JSXText")) {
      if ((child as EsTreeNodeOfType<"JSXText">).value.length > 0) return true;
      continue;
    }
    if (isNodeOfType(child as EsTreeNode, "JSXElement")) {
      const innerOpening = (child as EsTreeNodeOfType<"JSXElement">).openingElement;
      if (!isHiddenFromScreenReader(innerOpening, settings)) return true;
      continue;
    }
    if (isNodeOfType(child as EsTreeNode, "JSXExpressionContainer")) {
      const expression = (child as EsTreeNodeOfType<"JSXExpressionContainer">).expression;
      if (isNodeOfType(expression, "Literal") && expression.value === null) continue;
      if (isNodeOfType(expression, "Identifier") && expression.name === "undefined") continue;
      return true;
    }
  }
  if (hasJsxPropIgnoreCase(jsxElement.openingElement.attributes, "dangerouslySetInnerHTML"))
    return true;
  if (hasJsxPropIgnoreCase(jsxElement.openingElement.attributes, "children")) return true;
  // A spread (`{...props}`) can carry `children` at runtime, so the element
  // can't be proven empty — treat it as having accessible content rather
  // than emit a content-absence false positive (`<h1 {...props} />`).
  if (hasJsxSpreadAttribute(jsxElement.openingElement.attributes)) return true;
  return false;
};
