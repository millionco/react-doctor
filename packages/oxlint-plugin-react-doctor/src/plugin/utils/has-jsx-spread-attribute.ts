import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// True when a JSX element has a `{...spread}` attribute. Rules that decide
// based on the presence/absence of a specific prop should bail when a spread
// is present, since it can supply (or override) that prop at runtime.
export const hasJsxSpreadAttribute = (attributes: ReadonlyArray<EsTreeNode>): boolean =>
  attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"));
