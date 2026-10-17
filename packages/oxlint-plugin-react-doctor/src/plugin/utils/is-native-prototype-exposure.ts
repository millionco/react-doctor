import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

const NATIVE_PROTOTYPE_EXPOSURE_PROPERTY_NAMES = new Set([
  "constructor",
  "__proto__",
  "getPrototypeOf",
  "setPrototypeOf",
]);

export const isNativePrototypeExposure = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "MemberExpression")) {
    return NATIVE_PROTOTYPE_EXPOSURE_PROPERTY_NAMES.has(getStaticPropertyName(node) ?? "");
  }
  return (
    isNodeOfType(node, "Property") &&
    isNodeOfType(node.parent, "ObjectPattern") &&
    NATIVE_PROTOTYPE_EXPOSURE_PROPERTY_NAMES.has(
      getStaticPropertyKeyName(node, { allowComputedString: true }) ?? "",
    )
  );
};
