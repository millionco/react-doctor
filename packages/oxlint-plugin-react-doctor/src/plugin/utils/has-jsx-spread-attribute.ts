import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// True when a JSX element carries a spread (`{...props}`). Rules that prove
// the ABSENCE of an attribute must bail on a spread, since the spread could
// supply that attribute at runtime and a confident report would be a false
// positive.
export const hasJsxSpreadAttribute = (attributes: ReadonlyArray<EsTreeNode>): boolean =>
  attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"));
