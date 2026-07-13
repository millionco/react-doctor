import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export interface StaticPropertyKeyOptions {
  allowComputedString?: boolean;
  stringifyNonStringLiterals?: boolean;
}

export const getStaticPropertyKeyName = (
  node: EsTreeNode,
  options: StaticPropertyKeyOptions = {},
): string | null => {
  if (
    !isNodeOfType(node, "Property") &&
    !isNodeOfType(node, "MethodDefinition") &&
    !isNodeOfType(node, "MemberExpression")
  ) {
    return null;
  }
  const key = isNodeOfType(node, "MemberExpression") ? node.property : node.key;
  if (node.computed) {
    if (
      options.allowComputedString &&
      isNodeOfType(key, "Literal") &&
      typeof key.value === "string"
    ) {
      return key.value;
    }
    if (
      options.allowComputedString &&
      isNodeOfType(key, "TemplateLiteral") &&
      key.expressions.length === 0
    ) {
      return key.quasis[0]?.value.cooked ?? key.quasis[0]?.value.raw ?? null;
    }
    return null;
  }
  if (isNodeOfType(key, "Identifier")) return key.name;
  if (isNodeOfType(key, "Literal")) {
    if (typeof key.value === "string") return key.value;
    if (options.stringifyNonStringLiterals) return String(key.value);
  }
  return null;
};
