import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";

const isInsideStaticallyUnreachableBranch = (node: EsTreeNode): boolean => {
  let child = node;
  let parent = node.parent;
  while (parent) {
    if (isNodeOfType(parent, "IfStatement") && isNodeOfType(parent.test, "Literal")) {
      if (parent.test.value === false && parent.consequent === child) return true;
      if (parent.test.value === true && parent.alternate === child) return true;
    }
    if (isNodeOfType(parent, "ConditionalExpression") && isNodeOfType(parent.test, "Literal")) {
      if (parent.test.value === false && parent.consequent === child) return true;
      if (parent.test.value === true && parent.alternate === child) return true;
    }
    if (
      (isNodeOfType(parent, "WhileStatement") || isNodeOfType(parent, "ForStatement")) &&
      parent.body === child &&
      parent.test &&
      isNodeOfType(parent.test, "Literal") &&
      !parent.test.value
    ) {
      return true;
    }
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === child) {
      if (
        isNodeOfType(parent.left, "Literal") &&
        ((parent.operator === "&&" && !parent.left.value) ||
          (parent.operator === "||" && Boolean(parent.left.value)))
      ) {
        return true;
      }
    }
    child = parent;
    parent = parent.parent;
  }
  return false;
};

export const isNodeReachableWithinFunction = (node: EsTreeNode, context: RuleContext): boolean => {
  if (isInsideStaticallyUnreachableBranch(node)) return false;
  const owner = context.cfg.enclosingFunction(node);
  if (!owner) return true;
  const functionCfg = context.cfg.cfgFor(owner);
  if (!functionCfg) return true;
  const targetBlock = functionCfg.blockOf(node);
  if (!targetBlock) return true;
  const visitedBlocks = new Set([functionCfg.entry]);
  const pendingBlocks = [functionCfg.entry];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock) break;
    if (currentBlock === targetBlock) return true;
    for (const edge of currentBlock.successors) {
      if (visitedBlocks.has(edge.to)) continue;
      visitedBlocks.add(edge.to);
      pendingBlocks.push(edge.to);
    }
  }
  return false;
};
