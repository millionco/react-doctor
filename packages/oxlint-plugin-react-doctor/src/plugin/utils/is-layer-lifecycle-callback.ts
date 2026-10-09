import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isLayerLifecycleCallback = (node: EsTreeNode): boolean => {
  const property = node.parent;
  const object = property?.parent;
  const call = object?.parent;
  if (
    !isNodeOfType(property, "Property") ||
    property.value !== node ||
    !isNodeOfType(object, "ObjectExpression") ||
    !isNodeOfType(call, "CallExpression") ||
    call.arguments[0] !== object ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    getStaticPropertyName(call.callee) !== "extend" ||
    !isNodeOfType(call.callee.object, "MemberExpression") ||
    getStaticPropertyName(call.callee.object) !== "Layer"
  )
    return false;
  const name = getStaticPropertyKeyName(property);
  if (name !== "onAdd" && name !== "onRemove") return false;
  return object.properties.some(
    (candidate) =>
      isNodeOfType(candidate, "Property") &&
      getStaticPropertyKeyName(candidate) === (name === "onAdd" ? "onRemove" : "onAdd") &&
      isFunctionLike(candidate.value),
  );
};
