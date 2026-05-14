import { TANSTACK_ROUTE_CREATION_FUNCTIONS } from "../../../constants/tanstack.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const getRouteOptionsObject = (
  node: EsTreeNode,
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;

  const callee = node.callee;

  if (isNodeOfType(callee, "CallExpression") && isNodeOfType(callee.callee, "Identifier")) {
    if (!TANSTACK_ROUTE_CREATION_FUNCTIONS.has(callee.callee.name)) return null;
    const optionsArgument = node.arguments?.[0];
    if (isNodeOfType(optionsArgument, "ObjectExpression")) return optionsArgument;
    return null;
  }

  if (isNodeOfType(callee, "Identifier")) {
    if (!TANSTACK_ROUTE_CREATION_FUNCTIONS.has(callee.name)) return null;
    const optionsArgument = node.arguments?.[0];
    if (isNodeOfType(optionsArgument, "ObjectExpression")) return optionsArgument;
    return null;
  }

  return null;
};
