import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getConditionalExecutionRegions = (
  node: EsTreeNode,
  boundary: EsTreeNode,
): ReadonlySet<EsTreeNode> => {
  const regions = new Set<EsTreeNode>();
  let child = node;
  let parent = child.parent ?? null;
  while (parent && parent !== boundary) {
    if (isNodeOfType(parent, "IfStatement") && parent.test !== child) regions.add(child);
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === child || parent.alternate === child)
    ) {
      regions.add(child);
    }
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === child) regions.add(child);
    if (isNodeOfType(parent, "AssignmentPattern") && parent.right === child) regions.add(child);
    if (isNodeOfType(parent, "SwitchCase")) regions.add(parent);
    child = parent;
    parent = child.parent ?? null;
  }
  return regions;
};
