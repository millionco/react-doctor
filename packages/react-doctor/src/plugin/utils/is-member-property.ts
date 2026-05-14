import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isMemberProperty = (
  node: EsTreeNode | null | undefined,
  propertyName: string,
): node is EsTreeNodeOfType<"MemberExpression"> =>
  Boolean(
    node &&
    isNodeOfType(node, "MemberExpression") &&
    isNodeOfType(node.property, "Identifier") &&
    node.property.name === propertyName,
  );
