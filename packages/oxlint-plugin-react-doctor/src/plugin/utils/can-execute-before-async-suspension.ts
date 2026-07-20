import type { EsTreeNode } from "./es-tree-node.js";
import { findImmediatelyInvokedCallExpression } from "./find-immediately-invoked-call-expression.js";
import { getRangeStart } from "./get-range-start.js";
import { isDescendantWithoutFunctionBoundary } from "./is-descendant-without-function-boundary.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNodeReachableWithinFunction } from "./is-node-reachable-within-function.js";
import type { RuleContext } from "./rule-context.js";
import { walkAst } from "./walk-ast.js";

export interface CanExecuteBeforeAsyncSuspensionOptions {
  suspensionNodes?: Iterable<EsTreeNode>;
}

const collectSuspensionNodes = (
  functionNode: EsTreeNode,
  options: CanExecuteBeforeAsyncSuspensionOptions,
): Set<EsTreeNode> => {
  const suspensionNodes = new Set(options.suspensionNodes);
  walkAst(functionNode, (node: EsTreeNode) => {
    if (node !== functionNode && isFunctionLike(node)) return false;
    if (
      (!options.suspensionNodes && isNodeOfType(node, "AwaitExpression")) ||
      (isNodeOfType(node, "ForOfStatement") && node.await)
    ) {
      suspensionNodes.add(node);
    }
  });
  return suspensionNodes;
};

const isInsideForAwaitPostSuspensionRegion = (
  node: EsTreeNode,
  functionNode: EsTreeNode,
): boolean => {
  let current: EsTreeNode | null | undefined = node;
  while (current && current !== functionNode) {
    const parent: EsTreeNode | null | undefined = current.parent;
    if (
      parent &&
      isNodeOfType(parent, "ForOfStatement") &&
      parent.await &&
      (parent.left === current || parent.body === current)
    ) {
      return true;
    }
    current = parent;
  }
  return false;
};

const suspensionBlockNode = (suspensionNode: EsTreeNode): EsTreeNode =>
  isNodeOfType(suspensionNode, "ForOfStatement") ? suspensionNode.right : suspensionNode;

const doesSuspensionOccurBeforeNode = (suspensionNode: EsTreeNode, node: EsTreeNode): boolean => {
  if (isNodeOfType(suspensionNode, "AwaitExpression")) {
    if (isDescendantWithoutFunctionBoundary(node, suspensionNode.argument)) return false;
  } else if (
    isNodeOfType(suspensionNode, "ForOfStatement") &&
    isDescendantWithoutFunctionBoundary(node, suspensionNode.right)
  ) {
    return false;
  }
  if (isDescendantWithoutFunctionBoundary(suspensionNode, node)) return true;
  const suspensionStart = getRangeStart(suspensionBlockNode(suspensionNode));
  const nodeStart = getRangeStart(node);
  return suspensionStart !== null && nodeStart !== null && suspensionStart < nodeStart;
};

const findExecutionNodeWithinFunction = (
  node: EsTreeNode,
  functionNode: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  let executionNode = node;
  let executionOwner = context.cfg.enclosingFunction(executionNode);
  while (executionOwner && executionOwner !== functionNode) {
    if (!isFunctionLike(executionOwner) || executionOwner.async || executionOwner.generator) {
      return null;
    }
    const callExpression = findImmediatelyInvokedCallExpression(executionOwner);
    if (!callExpression) return null;
    executionNode = callExpression;
    executionOwner = context.cfg.enclosingFunction(callExpression);
  }
  return executionOwner === functionNode ? executionNode : null;
};

export const canExecuteBeforeAsyncSuspension = (
  node: EsTreeNode,
  functionNode: EsTreeNode,
  context: RuleContext,
  options: CanExecuteBeforeAsyncSuspensionOptions = {},
): boolean => {
  if (!isFunctionLike(functionNode) || !functionNode.async) {
    return isNodeReachableWithinFunction(node, context);
  }
  const executionNode = findExecutionNodeWithinFunction(node, functionNode, context);
  if (!executionNode || isInsideForAwaitPostSuspensionRegion(executionNode, functionNode)) {
    return false;
  }
  const functionCfg = context.cfg.cfgFor(functionNode);
  const targetBlock = functionCfg?.blockOf(executionNode);
  if (!functionCfg || !targetBlock) return false;
  const suspensionsByBlock = new Map<typeof targetBlock, EsTreeNode[]>();
  for (const suspensionNode of collectSuspensionNodes(functionNode, options)) {
    const suspensionBlock = functionCfg.blockOf(suspensionBlockNode(suspensionNode));
    if (!suspensionBlock) continue;
    const blockSuspensions = suspensionsByBlock.get(suspensionBlock) ?? [];
    blockSuspensions.push(suspensionNode);
    suspensionsByBlock.set(suspensionBlock, blockSuspensions);
  }
  const visitedBlocks = new Set<typeof targetBlock>();
  const pendingBlocks = [functionCfg.entry];
  while (pendingBlocks.length > 0) {
    const block = pendingBlocks.pop();
    if (!block || visitedBlocks.has(block)) continue;
    visitedBlocks.add(block);
    const blockSuspensions = suspensionsByBlock.get(block) ?? [];
    if (block === targetBlock) {
      return !blockSuspensions.some((suspensionNode) =>
        doesSuspensionOccurBeforeNode(suspensionNode, executionNode),
      );
    }
    if (blockSuspensions.length > 0) continue;
    for (const edge of block.successors) {
      if (edge.kind !== "throw") pendingBlocks.push(edge.to);
    }
  }
  return false;
};
