import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getTrailingJsxNameSegment } from "./get-trailing-jsx-name-segment.js";
import { isNodeOfType } from "./is-node-of-type.js";

export type RequiredAncestorPlacement =
  | "inside-required"
  | "inside-root-without-required"
  | "unprovable";

// Walks a part's JSX ancestors classifying its placement inside a composed
// widget. Only "provably inside the widget root without crossing the
// required container" is reportable: an extracted subcomponent (whose root
// lives in the parent file) never reaches the root, and an unresolved custom
// ancestor may itself be the required container's wrapper — both are
// unprovable, not violations.
export const findRequiredAncestorPlacement = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  classifyAncestorName: (elementName: EsTreeNode) => "required" | "root" | null,
): RequiredAncestorPlacement => {
  let ancestor: EsTreeNode | null | undefined = node.parent?.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXAttribute")) return "unprovable";
    if (isNodeOfType(ancestor, "JSXElement")) {
      const ancestorName = ancestor.openingElement.name;
      const classification = classifyAncestorName(ancestorName);
      if (classification === "required") return "inside-required";
      if (classification === "root") return "inside-root-without-required";
      const trailingSegment = getTrailingJsxNameSegment(ancestorName);
      if (
        trailingSegment !== null &&
        /^[A-Z]/.test(trailingSegment) &&
        trailingSegment !== "Fragment"
      ) {
        return "unprovable";
      }
    }
    ancestor = ancestor.parent;
  }
  return "unprovable";
};
