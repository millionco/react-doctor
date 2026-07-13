import { getStylePropertyKey } from "../../design/utils/get-style-property-key.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";

export const collectStylePropertyKeyNames = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
): Set<string> => {
  const keyNames = new Set<string>();
  for (const property of objectExpression.properties ?? []) {
    const keyName = getStylePropertyKey(property);
    if (keyName !== null) keyNames.add(keyName);
  }
  return keyNames;
};
