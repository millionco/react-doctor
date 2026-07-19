import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isAstDescendant } from "./is-ast-descendant.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";

const targetRequiresLogicalRight = (logicalExpression: EsTreeNode, target: EsTreeNode): boolean => {
  if (!isNodeOfType(logicalExpression, "LogicalExpression")) return false;
  const expressionRoot = findTransparentExpressionRoot(logicalExpression);
  const control = expressionRoot.parent;
  if (!control) return false;
  const targetMatchesBranch = (consequent: EsTreeNode, alternate: EsTreeNode | null): boolean => {
    if (logicalExpression.operator === "&&") return isAstDescendant(target, consequent);
    return Boolean(
      logicalExpression.operator === "||" && alternate && isAstDescendant(target, alternate),
    );
  };
  if (isNodeOfType(control, "IfStatement") && control.test === expressionRoot) {
    return targetMatchesBranch(control.consequent, control.alternate ?? null);
  }
  if (isNodeOfType(control, "ConditionalExpression") && control.test === expressionRoot) {
    return targetMatchesBranch(control.consequent, control.alternate);
  }
  if (
    (isNodeOfType(control, "WhileStatement") || isNodeOfType(control, "DoWhileStatement")) &&
    control.test === expressionRoot &&
    logicalExpression.operator === "&&"
  ) {
    return isAstDescendant(target, control.body);
  }
  if (
    isNodeOfType(control, "ForStatement") &&
    control.test === expressionRoot &&
    logicalExpression.operator === "&&"
  ) {
    return isAstDescendant(target, control.body);
  }
  return false;
};

export const nodeDominatesNode = (
  candidate: EsTreeNode,
  target: EsTreeNode,
  context: RuleContext,
): boolean => {
  const owner = context.cfg.enclosingFunction(target);
  if (!owner || context.cfg.enclosingFunction(candidate) !== owner) return false;
  const controlFlow = context.cfg.cfgFor(owner);
  const candidateBlock = controlFlow?.blockOf(candidate);
  const targetBlock = controlFlow?.blockOf(target);
  if (!controlFlow || !candidateBlock || !targetBlock) return false;
  let candidateChild = candidate;
  let candidateAncestor = candidate.parent ?? null;
  while (candidateAncestor && candidateAncestor !== owner) {
    let conditionalRegion: EsTreeNode | null = null;
    if (
      isNodeOfType(candidateAncestor, "LogicalExpression") &&
      candidateAncestor.right === candidateChild
    ) {
      conditionalRegion = candidateChild;
    } else if (
      isNodeOfType(candidateAncestor, "ConditionalExpression") &&
      candidateAncestor.test !== candidateChild
    ) {
      conditionalRegion = candidateChild;
    } else if (
      isNodeOfType(candidateAncestor, "AssignmentExpression") &&
      (candidateAncestor.operator === "&&=" ||
        candidateAncestor.operator === "||=" ||
        candidateAncestor.operator === "??=") &&
      candidateAncestor.right === candidateChild
    ) {
      conditionalRegion = candidateChild;
    } else if (
      isNodeOfType(candidateAncestor, "CallExpression") &&
      candidateAncestor.optional === true &&
      candidateAncestor.callee !== candidateChild
    ) {
      conditionalRegion = candidateAncestor;
    } else if (
      isNodeOfType(candidateAncestor, "MemberExpression") &&
      candidateAncestor.optional === true &&
      candidateAncestor.object !== candidateChild
    ) {
      conditionalRegion = candidateAncestor;
    }
    if (
      conditionalRegion &&
      !isAstDescendant(target, conditionalRegion) &&
      !targetRequiresLogicalRight(candidateAncestor, target)
    ) {
      return false;
    }
    candidateChild = candidateAncestor;
    candidateAncestor = candidateAncestor.parent ?? null;
  }
  const canReach = (
    startBlock: typeof controlFlow.entry,
    destinationBlock: typeof controlFlow.entry,
    excludedBlock?: typeof controlFlow.entry,
  ): boolean => {
    const visitedBlocks = new Set<typeof controlFlow.entry>();
    const pendingBlocks = startBlock === excludedBlock ? [] : [startBlock];
    while (pendingBlocks.length > 0) {
      const block = pendingBlocks.shift();
      if (!block || visitedBlocks.has(block)) continue;
      if (block === destinationBlock) return true;
      visitedBlocks.add(block);
      for (const edge of block.successors) {
        if (edge.to !== excludedBlock) pendingBlocks.push(edge.to);
      }
    }
    return false;
  };
  if (!canReach(controlFlow.entry, candidateBlock) || !canReach(controlFlow.entry, targetBlock)) {
    return false;
  }
  if (candidateBlock === targetBlock) return candidate.range[0] < target.range[0];
  return !canReach(controlFlow.entry, targetBlock, candidateBlock);
};
