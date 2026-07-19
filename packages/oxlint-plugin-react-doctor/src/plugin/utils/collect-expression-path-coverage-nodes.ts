import type { EsTreeNode } from "./es-tree-node.js";
import { getFinalSequenceExpressionValue } from "./get-final-sequence-expression-value.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { readStaticBoolean } from "./read-static-boolean.js";
import type { RuleContext } from "./rule-context.js";

export const collectExpressionPathCoverageNodes = (
  owner: EsTreeNode,
  matchingNodes: ReadonlyArray<EsTreeNode>,
  context: RuleContext,
  expressionBoundary: EsTreeNode = owner,
): Set<EsTreeNode> => {
  const coverageNodes = new Set<EsTreeNode>();
  const pendingNodes = matchingNodes.filter((matchingNode) => {
    if (context.cfg.enclosingFunction(matchingNode) !== owner) return false;
    let currentNode: EsTreeNode | null = matchingNode;
    while (currentNode && currentNode !== expressionBoundary) {
      currentNode = currentNode.parent ?? null;
    }
    return currentNode === expressionBoundary;
  });
  const visitedNodes = new Set(pendingNodes);
  const coveredBranchesByConditional = new Map<EsTreeNode, Set<"alternate" | "consequent">>();
  while (pendingNodes.length > 0) {
    const coverageCandidate = pendingNodes.pop();
    if (!coverageCandidate) break;
    if (coverageCandidate === expressionBoundary) {
      coverageNodes.add(coverageCandidate);
      continue;
    }
    let currentChild = coverageCandidate;
    let currentParent = currentChild.parent ?? null;
    let conditionalExpression: EsTreeNode | null = null;
    let conditionalBranch: "alternate" | "consequent" | null = null;
    let isBlockedByNonExhaustiveExpression = false;
    while (currentParent && currentParent !== expressionBoundary) {
      if (isNodeOfType(currentParent, "ConditionalExpression")) {
        const isConsequent = currentParent.consequent === currentChild;
        const isAlternate = currentParent.alternate === currentChild;
        if (isConsequent || isAlternate) {
          const staticTestValue = readStaticBoolean(
            getFinalSequenceExpressionValue(currentParent.test),
          );
          if (staticTestValue !== null) {
            if (staticTestValue !== isConsequent) {
              isBlockedByNonExhaustiveExpression = true;
              break;
            }
            currentChild = currentParent;
            currentParent = currentChild.parent ?? null;
            continue;
          }
          conditionalExpression = currentParent;
          conditionalBranch = isConsequent ? "consequent" : "alternate";
          break;
        }
      }
      if (
        isNodeOfType(currentParent, "LogicalExpression") &&
        currentParent.right === currentChild
      ) {
        const staticLeftValue = readStaticBoolean(
          getFinalSequenceExpressionValue(currentParent.left),
        );
        const isRightGuaranteed =
          (currentParent.operator === "&&" && staticLeftValue === true) ||
          (currentParent.operator === "||" && staticLeftValue === false);
        if (!isRightGuaranteed) {
          isBlockedByNonExhaustiveExpression = true;
          break;
        }
      }
      if (
        isNodeOfType(currentParent, "AssignmentPattern") &&
        currentParent.right === currentChild
      ) {
        isBlockedByNonExhaustiveExpression = true;
        break;
      }
      currentChild = currentParent;
      currentParent = currentChild.parent ?? null;
    }
    if (isBlockedByNonExhaustiveExpression) continue;
    if (!conditionalExpression || !conditionalBranch) {
      coverageNodes.add(coverageCandidate);
      continue;
    }
    const coveredBranches = coveredBranchesByConditional.get(conditionalExpression) ?? new Set();
    coveredBranches.add(conditionalBranch);
    coveredBranchesByConditional.set(conditionalExpression, coveredBranches);
    if (
      coveredBranches.has("alternate") &&
      coveredBranches.has("consequent") &&
      !visitedNodes.has(conditionalExpression)
    ) {
      visitedNodes.add(conditionalExpression);
      pendingNodes.push(conditionalExpression);
    }
  }
  return coverageNodes;
};
