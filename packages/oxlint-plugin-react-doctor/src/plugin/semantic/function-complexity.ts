import { forEachChildNode, walkAst } from "../utils/walk-ast.js";
import type { EsTreeNode } from "../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../utils/is-function-like.js";
import { isNodeOfType } from "../utils/is-node-of-type.js";
import type { BasicBlock, FunctionCfg } from "./control-flow-graph.js";
import { CYCLOMATIC_CONNECTED_COMPONENT_WEIGHT } from "./constants.js";

export interface FunctionComplexityMetrics {
  readonly cognitive: number;
  readonly cyclomatic: number;
  readonly maxNestingDepth: number;
}

interface CognitiveComplexityAccumulator {
  cognitive: number;
  maxNestingDepth: number;
}

interface LogicalOperatorRunState {
  previousOperator: "&&" | "||" | "??" | null;
}

const collectReachableBlocks = (entryBlock: BasicBlock): Set<BasicBlock> => {
  const reachableBlocks = new Set<BasicBlock>();
  const pendingBlocks = [entryBlock];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock || reachableBlocks.has(currentBlock)) continue;
    reachableBlocks.add(currentBlock);
    for (const edge of currentBlock.successors) pendingBlocks.push(edge.to);
  }
  return reachableBlocks;
};

const countWeaklyConnectedComponents = (blocks: ReadonlySet<BasicBlock>): number => {
  const visitedBlocks = new Set<BasicBlock>();
  let componentCount = 0;
  for (const block of blocks) {
    if (visitedBlocks.has(block)) continue;
    componentCount += 1;
    const pendingBlocks = [block];
    while (pendingBlocks.length > 0) {
      const currentBlock = pendingBlocks.pop();
      if (!currentBlock || visitedBlocks.has(currentBlock)) continue;
      visitedBlocks.add(currentBlock);
      for (const edge of currentBlock.successors) {
        if (blocks.has(edge.to)) pendingBlocks.push(edge.to);
      }
      for (const edge of currentBlock.predecessors) {
        if (blocks.has(edge.from)) pendingBlocks.push(edge.from);
      }
    }
  }
  return componentCount;
};

const calculateCyclomaticComplexity = (functionControlFlow: FunctionCfg): number => {
  const reachableBlocks = collectReachableBlocks(functionControlFlow.entry);
  let edgeCount = 0;
  for (const block of reachableBlocks) {
    for (const edge of block.successors) {
      if (reachableBlocks.has(edge.to)) edgeCount += 1;
    }
  }
  return (
    edgeCount -
    reachableBlocks.size +
    CYCLOMATIC_CONNECTED_COMPONENT_WEIGHT * countWeaklyConnectedComponents(reachableBlocks)
  );
};

const isCognitiveLogicalOperator = (operator: string): operator is "&&" | "||" | "??" =>
  operator === "&&" || operator === "||" || operator === "??";

const isLogicalAssignmentOperator = (operator: string): boolean =>
  operator === "&&=" || operator === "||=" || operator === "??=";

const countExpressionDecisionPoints = (rootNode: EsTreeNode): number => {
  let decisionPointCount = 0;
  walkAst(rootNode, (node) => {
    if (node !== rootNode && isFunctionLike(node)) return false;
    if (
      isNodeOfType(node, "ConditionalExpression") ||
      isNodeOfType(node, "LogicalExpression") ||
      (isNodeOfType(node, "AssignmentExpression") && isLogicalAssignmentOperator(node.operator))
    ) {
      decisionPointCount += 1;
    }
  });
  return decisionPointCount;
};

const countLogicalOperatorRuns = (rootNode: EsTreeNode): number => {
  let logicalRunCount = 0;
  const visitNode = (node: EsTreeNode, runState: LogicalOperatorRunState | null): void => {
    if (node !== rootNode && isFunctionLike(node)) return;
    if (isNodeOfType(node, "LogicalExpression")) {
      const currentRunState = runState ?? { previousOperator: null };
      const operator = isCognitiveLogicalOperator(node.operator) ? node.operator : null;
      visitNode(node.left, currentRunState);
      if (operator !== null && operator !== currentRunState.previousOperator) logicalRunCount += 1;
      currentRunState.previousOperator = operator;
      visitNode(node.right, currentRunState);
      return;
    }
    forEachChildNode(node, (childNode) => visitNode(childNode, null));
  };
  visitNode(rootNode, null);
  return logicalRunCount;
};

const recordNestedControlFlow = (
  accumulator: CognitiveComplexityAccumulator,
  nestingDepth: number,
): void => {
  accumulator.cognitive += 1 + nestingDepth;
  accumulator.maxNestingDepth = Math.max(accumulator.maxNestingDepth, nestingDepth + 1);
};

const measureCognitiveComplexity = (rootNode: EsTreeNode): CognitiveComplexityAccumulator => {
  const accumulator: CognitiveComplexityAccumulator = {
    cognitive: 0,
    maxNestingDepth: 0,
  };

  const visitNode = (node: EsTreeNode, nestingDepth: number): void => {
    if (node !== rootNode && isFunctionLike(node)) return;

    if (isNodeOfType(node, "IfStatement")) {
      const visitIfStatement = (
        ifStatement: EsTreeNodeOfType<"IfStatement">,
        isElseIf: boolean,
      ): void => {
        if (isElseIf) {
          accumulator.cognitive += 1;
          accumulator.maxNestingDepth = Math.max(accumulator.maxNestingDepth, nestingDepth + 1);
        } else {
          recordNestedControlFlow(accumulator, nestingDepth);
        }
        visitNode(ifStatement.test, nestingDepth);
        visitNode(ifStatement.consequent, nestingDepth + 1);
        if (!ifStatement.alternate) return;
        if (isNodeOfType(ifStatement.alternate, "IfStatement")) {
          visitIfStatement(ifStatement.alternate, true);
        } else {
          accumulator.cognitive += 1;
          visitNode(ifStatement.alternate, nestingDepth + 1);
        }
      };
      visitIfStatement(node, false);
      return;
    }

    if (isNodeOfType(node, "ConditionalExpression")) {
      recordNestedControlFlow(accumulator, nestingDepth);
      visitNode(node.test, nestingDepth);
      visitNode(node.consequent, nestingDepth + 1);
      visitNode(node.alternate, nestingDepth + 1);
      return;
    }

    if (isNodeOfType(node, "ForStatement")) {
      recordNestedControlFlow(accumulator, nestingDepth);
      if (node.init) visitNode(node.init, nestingDepth);
      if (node.test) visitNode(node.test, nestingDepth);
      if (node.update) visitNode(node.update, nestingDepth);
      visitNode(node.body, nestingDepth + 1);
      return;
    }

    if (isNodeOfType(node, "ForInStatement") || isNodeOfType(node, "ForOfStatement")) {
      recordNestedControlFlow(accumulator, nestingDepth);
      visitNode(node.left, nestingDepth);
      visitNode(node.right, nestingDepth);
      visitNode(node.body, nestingDepth + 1);
      return;
    }

    if (isNodeOfType(node, "WhileStatement")) {
      recordNestedControlFlow(accumulator, nestingDepth);
      visitNode(node.test, nestingDepth);
      visitNode(node.body, nestingDepth + 1);
      return;
    }

    if (isNodeOfType(node, "DoWhileStatement")) {
      recordNestedControlFlow(accumulator, nestingDepth);
      visitNode(node.body, nestingDepth + 1);
      visitNode(node.test, nestingDepth);
      return;
    }

    if (isNodeOfType(node, "SwitchStatement")) {
      recordNestedControlFlow(accumulator, nestingDepth);
      visitNode(node.discriminant, nestingDepth);
      for (const switchCase of node.cases) {
        if (switchCase.test) visitNode(switchCase.test, nestingDepth);
        for (const statement of switchCase.consequent) {
          visitNode(statement, nestingDepth + 1);
        }
      }
      return;
    }

    if (isNodeOfType(node, "CatchClause")) {
      recordNestedControlFlow(accumulator, nestingDepth);
      if (node.param) visitNode(node.param, nestingDepth);
      visitNode(node.body, nestingDepth + 1);
      return;
    }

    if (
      (isNodeOfType(node, "BreakStatement") || isNodeOfType(node, "ContinueStatement")) &&
      node.label
    ) {
      accumulator.cognitive += 1;
      return;
    }

    forEachChildNode(node, (childNode) => visitNode(childNode, nestingDepth));
  };

  visitNode(rootNode, 0);
  accumulator.cognitive += countLogicalOperatorRuns(rootNode);
  return accumulator;
};

export const calculateFunctionComplexity = (
  functionNode: EsTreeNode,
  functionControlFlow: FunctionCfg,
): FunctionComplexityMetrics => {
  const analysisRoot = isFunctionLike(functionNode) ? functionNode.body : functionNode;
  const cognitiveMetrics = measureCognitiveComplexity(analysisRoot);
  return {
    cognitive: cognitiveMetrics.cognitive,
    cyclomatic:
      calculateCyclomaticComplexity(functionControlFlow) +
      countExpressionDecisionPoints(analysisRoot),
    maxNestingDepth: cognitiveMetrics.maxNestingDepth,
  };
};
