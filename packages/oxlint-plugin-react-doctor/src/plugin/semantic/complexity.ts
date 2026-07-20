import type { EsTreeNode } from "../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../utils/es-tree-node-of-type.js";
import { isAstNode } from "../utils/is-ast-node.js";
import { isFunctionLike } from "../utils/is-function-like.js";
import { isNodeOfType } from "../utils/is-node-of-type.js";
import type { BasicBlock, FunctionCfg } from "./control-flow-graph.js";
import {
  collectFunctionNodes,
  createComplexityPositionResolver,
  getFunctionKind,
  getFunctionName,
  getNodeStartOffset,
  visitChildren,
  walkAllNodes,
} from "./complexity-helpers.js";
import { analyzeControlFlow } from "./control-flow-graph.js";

export interface FunctionComplexity {
  name: string;
  kind: "module" | "component" | "hook" | "method" | "arrow" | "function";
  line: number;
  column: number;
  cyclomatic: number;
  cognitive: number;
  nodeCount: number;
  edgeCount: number;
  components: number;
  decisionPoints: number;
  maxNestingDepth: number;
}

export interface FileComplexity {
  functions: FunctionComplexity[];
  totalCyclomatic: number;
  totalCognitive: number;
}

interface ComplexityTotals {
  cognitive: number;
  decisionPoints: number;
  maxNestingDepth: number;
}

const MODULE_NAME = "<module>";

const collectReachableBlocks = (entryBlock: BasicBlock): Set<BasicBlock> => {
  const reachableBlocks = new Set<BasicBlock>();
  const queue: BasicBlock[] = [entryBlock];
  while (queue.length > 0) {
    const block = queue.shift()!;
    if (reachableBlocks.has(block)) continue;
    reachableBlocks.add(block);
    for (const edge of block.successors) {
      queue.push(edge.to);
    }
  }
  return reachableBlocks;
};

const countWeaklyConnectedComponents = (blocks: ReadonlySet<BasicBlock>): number => {
  const visited = new Set<BasicBlock>();
  let componentCount = 0;
  for (const block of blocks) {
    if (visited.has(block)) continue;
    componentCount += 1;
    const queue: BasicBlock[] = [block];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const edge of current.successors) {
        if (blocks.has(edge.to) && !visited.has(edge.to)) queue.push(edge.to);
      }
      for (const edge of current.predecessors) {
        if (blocks.has(edge.from) && !visited.has(edge.from)) queue.push(edge.from);
      }
    }
  }
  return componentCount;
};

const calculateCyclomatic = (
  cfg: FunctionCfg,
): {
  cyclomatic: number;
  nodeCount: number;
  edgeCount: number;
  components: number;
} => {
  const reachableBlocks = collectReachableBlocks(cfg.entry);
  let edgeCount = 0;
  for (const block of reachableBlocks) {
    for (const edge of block.successors) {
      if (reachableBlocks.has(edge.to)) edgeCount += 1;
    }
  }
  const nodeCount = reachableBlocks.size;
  const components = countWeaklyConnectedComponents(reachableBlocks);
  return {
    cyclomatic: edgeCount - nodeCount + 2 * components,
    nodeCount,
    edgeCount,
    components,
  };
};

const isSupportedLogicalOperator = (operator: string): operator is "&&" | "||" =>
  operator === "&&" || operator === "||";

const countDecisionPoints = (root: EsTreeNode): number => {
  let total = 0;
  walkAllNodes(root, (node) => {
    if (isFunctionLike(node) && node !== root) return false;
    if (
      isNodeOfType(node, "IfStatement") ||
      isNodeOfType(node, "ConditionalExpression") ||
      isNodeOfType(node, "ForStatement") ||
      isNodeOfType(node, "ForInStatement") ||
      isNodeOfType(node, "ForOfStatement") ||
      isNodeOfType(node, "WhileStatement") ||
      isNodeOfType(node, "DoWhileStatement") ||
      isNodeOfType(node, "CatchClause")
    ) {
      total += 1;
      return true;
    }
    if (isNodeOfType(node, "SwitchCase") && node.test !== null) {
      total += 1;
      return true;
    }
    if (isNodeOfType(node, "LogicalExpression") && isSupportedLogicalOperator(node.operator)) {
      total += 1;
    }
    return true;
  });
  return total;
};

const countLogicalRuns = (root: EsTreeNode): number => {
  let total = 0;
  walkAllNodes(root, (node) => {
    if (isFunctionLike(node) && node !== root) return false;
    if (!isNodeOfType(node, "LogicalExpression")) return true;

    let previousOperator: "&&" | "||" | null = null;
    const visitLogical = (expression: EsTreeNode): void => {
      if (!isNodeOfType(expression, "LogicalExpression")) return;
      visitLogical(expression.left);
      if (isSupportedLogicalOperator(expression.operator)) {
        if (expression.operator !== previousOperator) {
          total += 1;
          previousOperator = expression.operator;
        }
      }
      visitLogical(expression.right);
    };
    visitLogical(node);
    return false;
  });
  return total;
};

const updateMaxDepth = (currentMax: number, candidate: number): number =>
  candidate > currentMax ? candidate : currentMax;

const measureCognitive = (root: EsTreeNode): ComplexityTotals => {
  const totals: ComplexityTotals = {
    cognitive: 0,
    decisionPoints: 0,
    maxNestingDepth: 0,
  };

  const visit = (node: EsTreeNode, nestingDepth: number): void => {
    if (isFunctionLike(node) && node !== root) return;

    if (isNodeOfType(node, "IfStatement")) {
      const visitIfStatement = (
        ifNode: EsTreeNodeOfType<"IfStatement">,
        currentNestingDepth: number,
        isElseIf: boolean,
      ): void => {
        totals.cognitive += isElseIf ? 1 : 1 + currentNestingDepth;
        totals.maxNestingDepth = updateMaxDepth(totals.maxNestingDepth, currentNestingDepth + 1);
        visit(ifNode.test, currentNestingDepth);
        visit(ifNode.consequent, currentNestingDepth + 1);
        if (!ifNode.alternate) return;
        if (isNodeOfType(ifNode.alternate, "IfStatement")) {
          visitIfStatement(ifNode.alternate, currentNestingDepth, true);
        } else {
          visit(ifNode.alternate, currentNestingDepth + 1);
        }
      };
      visitIfStatement(node, nestingDepth, false);
      return;
    }

    if (isNodeOfType(node, "ConditionalExpression")) {
      totals.cognitive += 1 + nestingDepth;
      totals.maxNestingDepth = updateMaxDepth(totals.maxNestingDepth, nestingDepth + 1);
      visit(node.test, nestingDepth);
      visit(node.consequent, nestingDepth + 1);
      visit(node.alternate, nestingDepth + 1);
      return;
    }

    if (isNodeOfType(node, "ForStatement")) {
      totals.cognitive += 1 + nestingDepth;
      totals.maxNestingDepth = updateMaxDepth(totals.maxNestingDepth, nestingDepth + 1);
      if (node.init) visit(node.init, nestingDepth);
      if (node.test) visit(node.test, nestingDepth);
      if (node.update) visit(node.update, nestingDepth);
      visit(node.body, nestingDepth + 1);
      return;
    }

    if (isNodeOfType(node, "ForInStatement") || isNodeOfType(node, "ForOfStatement")) {
      totals.cognitive += 1 + nestingDepth;
      totals.maxNestingDepth = updateMaxDepth(totals.maxNestingDepth, nestingDepth + 1);
      visit(node.left, nestingDepth);
      visit(node.right, nestingDepth);
      visit(node.body, nestingDepth + 1);
      return;
    }

    if (isNodeOfType(node, "WhileStatement") || isNodeOfType(node, "DoWhileStatement")) {
      totals.cognitive += 1 + nestingDepth;
      totals.maxNestingDepth = updateMaxDepth(totals.maxNestingDepth, nestingDepth + 1);
      if (isNodeOfType(node, "WhileStatement")) {
        visit(node.test, nestingDepth);
        visit(node.body, nestingDepth + 1);
      } else {
        visit(node.body, nestingDepth + 1);
        visit(node.test, nestingDepth);
      }
      return;
    }

    if (isNodeOfType(node, "SwitchStatement")) {
      totals.cognitive += 1 + nestingDepth;
      totals.maxNestingDepth = updateMaxDepth(totals.maxNestingDepth, nestingDepth + 1);
      visit(node.discriminant, nestingDepth);
      for (const switchCase of node.cases) {
        if (switchCase.test) visit(switchCase.test, nestingDepth);
        for (const statement of switchCase.consequent) {
          visit(statement, nestingDepth + 1);
        }
      }
      return;
    }

    if (isNodeOfType(node, "CatchClause")) {
      totals.cognitive += 1 + nestingDepth;
      totals.maxNestingDepth = updateMaxDepth(totals.maxNestingDepth, nestingDepth + 1);
      if (isAstNode(node.param)) visit(node.param, nestingDepth);
      visit(node.body, nestingDepth + 1);
      return;
    }

    if (isNodeOfType(node, "BreakStatement") || isNodeOfType(node, "ContinueStatement")) {
      if (node.label) totals.cognitive += 1;
      return;
    }

    if (isNodeOfType(node, "LogicalExpression")) {
      visit(node.left, nestingDepth);
      visit(node.right, nestingDepth);
      return;
    }

    if (isNodeOfType(node, "Program")) {
      for (const statement of node.body) visit(statement, nestingDepth);
      return;
    }

    if (isNodeOfType(node, "BlockStatement")) {
      for (const statement of node.body) visit(statement, nestingDepth);
      return;
    }

    if (isNodeOfType(node, "LabeledStatement")) {
      visit(node.body, nestingDepth);
      return;
    }

    if (isNodeOfType(node, "TryStatement")) {
      visit(node.block, nestingDepth);
      if (node.handler) visit(node.handler, nestingDepth);
      if (node.finalizer) visit(node.finalizer, nestingDepth);
      return;
    }

    visitChildren(node, (child) => visit(child, nestingDepth));
  };

  visit(root, 0);
  totals.cognitive += countLogicalRuns(root);
  totals.decisionPoints = countDecisionPoints(root);
  return totals;
};

const buildFunctionComplexity = (
  root: EsTreeNode,
  functionNode: EsTreeNode,
  cfgAnalysis: ReturnType<typeof analyzeControlFlow>,
  resolvePosition: (offset: number | undefined) => { line: number; column: number },
): FunctionComplexity => {
  const name = root === functionNode ? MODULE_NAME : getFunctionName(functionNode);
  const kind = getFunctionKind(functionNode, name);
  const position = resolvePosition(getNodeStartOffset(functionNode));
  const analysisRoot = isNodeOfType(functionNode, "Program")
    ? functionNode
    : isFunctionLike(functionNode)
      ? functionNode.body
      : functionNode;
  const cfg = cfgAnalysis.cfgFor(functionNode);
  const cyclomaticMetrics = cfg
    ? calculateCyclomatic(cfg)
    : { cyclomatic: 0, nodeCount: 0, edgeCount: 0, components: 0 };
  const cognitiveMetrics = measureCognitive(analysisRoot);

  return {
    name,
    kind,
    line: position.line,
    column: position.column,
    cyclomatic: cyclomaticMetrics.cyclomatic,
    cognitive: cognitiveMetrics.cognitive,
    nodeCount: cyclomaticMetrics.nodeCount,
    edgeCount: cyclomaticMetrics.edgeCount,
    components: cyclomaticMetrics.components,
    decisionPoints: cognitiveMetrics.decisionPoints,
    maxNestingDepth: cognitiveMetrics.maxNestingDepth,
  };
};

export const analyzeComplexity = (program: EsTreeNode, sourceText: string): FileComplexity => {
  const resolvePosition = createComplexityPositionResolver(sourceText);
  const cfgAnalysis = analyzeControlFlow(program);
  const functions = [program, ...collectFunctionNodes(program)].map((functionNode) =>
    buildFunctionComplexity(program, functionNode, cfgAnalysis, resolvePosition),
  );
  return {
    functions,
    totalCyclomatic: functions.reduce((total, entry) => total + entry.cyclomatic, 0),
    totalCognitive: functions.reduce((total, entry) => total + entry.cognitive, 0),
  };
};
