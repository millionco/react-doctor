import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const stripThisParameter = (
  parameters: ReadonlyArray<EsTreeNode>,
): ReadonlyArray<EsTreeNode> => {
  const firstParameter = parameters[0];
  if (!firstParameter) return parameters;
  if (isNodeOfType(firstParameter, "Identifier") && firstParameter.name === "this") {
    return parameters.slice(1);
  }
  return parameters;
};
