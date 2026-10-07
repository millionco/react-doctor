import type { EsTreeNode } from "./es-tree-node.js";
import { flattenJsxName } from "./flatten-jsx-name.js";

// The last dotted segment of a JSX element name (`Dialog.Title` → `"Title"`,
// `Button` → `"Button"`), or null when the chain root isn't a JSXIdentifier.
// The segment is what naming heuristics compare against, since namespace
// prefixes vary per import style.
export const getTrailingJsxNameSegment = (elementName: EsTreeNode): string | null =>
  flattenJsxName(elementName)?.split(".").at(-1) ?? null;
