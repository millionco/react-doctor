import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";

export const getStylePropertyKey = (property: EsTreeNode): string | null =>
  getStaticPropertyKeyName(property, { allowComputedString: true });
