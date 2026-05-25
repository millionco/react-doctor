import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const flattenCalleeName = (callee: EsTreeNode): string | null => {
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (!isNodeOfType(callee, "MemberExpression")) return null;

  const objectName = flattenCalleeName(callee.object);
  if (!objectName) return null;
  if (!isNodeOfType(callee.property, "Identifier") || callee.computed) return null;

  return `${objectName}.${callee.property.name}`;
};
