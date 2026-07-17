import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticJsxOpeningElements } from "./get-static-jsx-opening-elements.js";
import { getStaticJsxTreeRoot } from "./get-static-jsx-tree-root.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getStaticJsxTreeOpeningElements = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): ReadonlyArray<EsTreeNodeOfType<"JSXOpeningElement">> | null => {
  const root = getStaticJsxTreeRoot(openingElement);
  if (!root || (!isNodeOfType(root, "JSXElement") && !isNodeOfType(root, "JSXFragment"))) {
    return null;
  }
  const openingElements = getStaticJsxOpeningElements(root);
  return openingElements[0] === openingElement ? openingElements : null;
};
