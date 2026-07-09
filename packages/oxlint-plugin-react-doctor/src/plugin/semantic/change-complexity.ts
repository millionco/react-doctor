import type { EsTreeNode } from "../utils/es-tree-node.js";
import { getCalleeName } from "../utils/get-callee-name.js";
import { isNodeOfType } from "../utils/is-node-of-type.js";
import { isReactHookName } from "../utils/is-react-hook-name.js";
import { calculateLineDiff } from "../utils/calculate-line-diff.js";
import {
  buildComplexityFunctionKey,
  collectFunctionNodes,
  createComplexityPositionResolver,
  getFunctionKind,
  getFunctionName,
  getNodeStartOffset,
  visitChildren,
  walkAllNodes,
} from "./complexity-helpers.js";
import {
  CHANGE_COMPLEXITY_ASYNC_AWAIT_NODE_WEIGHT,
  CHANGE_COMPLEXITY_CALL_NODE_WEIGHT,
  CHANGE_COMPLEXITY_CONTROL_FLOW_NODE_WEIGHT,
  CHANGE_COMPLEXITY_COGNITIVE_WEIGHT,
  CHANGE_COMPLEXITY_CYCLOMATIC_WEIGHT,
  CHANGE_COMPLEXITY_DELETION_WEIGHT_FACTOR,
  CHANGE_COMPLEXITY_DEFAULT_NODE_WEIGHT,
  CHANGE_COMPLEXITY_FUNCTION_NODE_WEIGHT,
  CHANGE_COMPLEXITY_HOOK_CALL_NODE_WEIGHT,
  CHANGE_COMPLEXITY_INSERTION_WEIGHT_FACTOR,
  CHANGE_COMPLEXITY_JSX_NODE_WEIGHT,
  CHANGE_COMPLEXITY_LOGICAL_NODE_WEIGHT,
  CHANGE_COMPLEXITY_MAX_TREE_EDIT_NODE_COUNT,
  CHANGE_COMPLEXITY_NESTING_WEIGHT,
  CHANGE_COMPLEXITY_RELABEL_WEIGHT_FACTOR,
  CHANGE_COMPLEXITY_TRY_CATCH_NODE_WEIGHT,
} from "./constants.js";

export interface ChangeComplexityFunctionEntry {
  readonly key: string;
  readonly name: string;
  readonly kind: "module" | "component" | "hook" | "method" | "arrow" | "function";
  readonly line: number;
  readonly column: number;
  readonly node: EsTreeNode;
  readonly sourceText: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface ChangeComplexityTreeEditResult {
  readonly essentialChange: number;
  readonly approximate: boolean;
}

export interface ChangeComplexityDeltaMetrics {
  readonly essentialChange: number;
  readonly essentialChangeApproximate: boolean;
  readonly rawLinesChanged: number | null;
  readonly bloatRatio: number | null;
  readonly nestingDelta: number;
  readonly changeComplexity: number;
}

export interface ChangeComplexitySummaryMetrics {
  readonly totalEssentialChange: number;
  readonly totalStructuralRisk: number;
  readonly changeEntropy: number;
  readonly normalizedChangeEntropy: number;
  readonly changeComplexityScore: number;
}

interface NodeWithRange {
  readonly start?: number;
  readonly end?: number;
}

interface NodeMetrics {
  readonly nodeCount: number;
  readonly weightedNodeCost: number;
}

const getNodeRange = (node: EsTreeNode): { start: number; end: number } => {
  const rangeNode = node as NodeWithRange;
  const start = typeof rangeNode.start === "number" ? rangeNode.start : 0;
  const end = typeof rangeNode.end === "number" ? rangeNode.end : start;
  return { start, end };
};

const getNodeSourceText = (node: EsTreeNode, sourceText: string): string => {
  const { start, end } = getNodeRange(node);
  return sourceText.slice(start, end);
};

const getNodeWeight = (node: EsTreeNode): number => {
  if (
    isNodeOfType(node, "Identifier") ||
    isNodeOfType(node, "Literal") ||
    isNodeOfType(node, "PrivateIdentifier") ||
    isNodeOfType(node, "ThisExpression") ||
    isNodeOfType(node, "Super") ||
    isNodeOfType(node, "TemplateElement") ||
    isNodeOfType(node, "JSXText") ||
    isNodeOfType(node, "JSXIdentifier") ||
    isNodeOfType(node, "JSXNamespacedName") ||
    isNodeOfType(node, "TSAsExpression") ||
    isNodeOfType(node, "TSSatisfiesExpression") ||
    isNodeOfType(node, "TSNonNullExpression") ||
    isNodeOfType(node, "ChainExpression") ||
    isNodeOfType(node, "ExpressionStatement") ||
    isNodeOfType(node, "BlockStatement") ||
    isNodeOfType(node, "Program")
  ) {
    return CHANGE_COMPLEXITY_DEFAULT_NODE_WEIGHT;
  }

  if (
    isNodeOfType(node, "FunctionDeclaration") ||
    isNodeOfType(node, "FunctionExpression") ||
    isNodeOfType(node, "ArrowFunctionExpression")
  ) {
    return CHANGE_COMPLEXITY_FUNCTION_NODE_WEIGHT;
  }

  if (
    isNodeOfType(node, "IfStatement") ||
    isNodeOfType(node, "ConditionalExpression") ||
    isNodeOfType(node, "ForStatement") ||
    isNodeOfType(node, "ForInStatement") ||
    isNodeOfType(node, "ForOfStatement") ||
    isNodeOfType(node, "WhileStatement") ||
    isNodeOfType(node, "DoWhileStatement") ||
    isNodeOfType(node, "SwitchStatement") ||
    (node.type === "SwitchCase" && node.test !== null)
  ) {
    return CHANGE_COMPLEXITY_CONTROL_FLOW_NODE_WEIGHT;
  }

  if (isNodeOfType(node, "TryStatement") || isNodeOfType(node, "CatchClause")) {
    return CHANGE_COMPLEXITY_TRY_CATCH_NODE_WEIGHT;
  }

  if (isNodeOfType(node, "AwaitExpression") || isNodeOfType(node, "YieldExpression")) {
    return CHANGE_COMPLEXITY_ASYNC_AWAIT_NODE_WEIGHT;
  }

  if (isNodeOfType(node, "JSXElement") || isNodeOfType(node, "JSXFragment")) {
    return CHANGE_COMPLEXITY_JSX_NODE_WEIGHT;
  }

  if (isNodeOfType(node, "CallExpression")) {
    const calleeName = getCalleeName(node);
    if (calleeName && isReactHookName(calleeName)) {
      return CHANGE_COMPLEXITY_HOOK_CALL_NODE_WEIGHT;
    }
    return CHANGE_COMPLEXITY_CALL_NODE_WEIGHT;
  }

  if (isNodeOfType(node, "LogicalExpression")) {
    return CHANGE_COMPLEXITY_LOGICAL_NODE_WEIGHT;
  }

  return CHANGE_COMPLEXITY_DEFAULT_NODE_WEIGHT;
};

const measureNodeMetrics = (root: EsTreeNode): NodeMetrics => {
  let nodeCount = 0;
  let weightedNodeCost = 0;
  walkAllNodes(root, (node) => {
    nodeCount += 1;
    weightedNodeCost += getNodeWeight(node);
  });
  return { nodeCount, weightedNodeCost };
};

const getNodeChildren = (node: EsTreeNode): EsTreeNode[] => {
  const children: EsTreeNode[] = [];
  visitChildren(node, (child) => {
    children.push(child);
  });
  return children;
};

const getWeightedSubtreeCost = (node: EsTreeNode, operationWeightFactor: number): number => {
  let totalCost = getNodeWeight(node) * operationWeightFactor;
  for (const child of getNodeChildren(node)) {
    totalCost += getWeightedSubtreeCost(child, operationWeightFactor);
  }
  return totalCost;
};

const getDeleteCost = (node: EsTreeNode): number =>
  getWeightedSubtreeCost(node, CHANGE_COMPLEXITY_DELETION_WEIGHT_FACTOR);

const getInsertCost = (node: EsTreeNode): number =>
  getWeightedSubtreeCost(node, CHANGE_COMPLEXITY_INSERTION_WEIGHT_FACTOR);

const compareTreeNodes = (
  headNode: EsTreeNode,
  baseNode: EsTreeNode,
  memo: WeakMap<EsTreeNode, WeakMap<EsTreeNode, number>>,
): number => {
  const cachedHead = memo.get(headNode);
  const cachedValue = cachedHead?.get(baseNode);
  if (cachedValue !== undefined) return cachedValue;

  const headChildren = getNodeChildren(headNode);
  const baseChildren = getNodeChildren(baseNode);
  const rowCount = headChildren.length;
  const columnCount = baseChildren.length;
  const alignTable: number[][] = Array.from({ length: rowCount + 1 }, () =>
    Array.from({ length: columnCount + 1 }, () => 0),
  );

  for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
    alignTable[rowIndex]![0] =
      alignTable[rowIndex - 1]![0]! + getDeleteCost(headChildren[rowIndex - 1]!);
  }
  for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
    alignTable[0]![columnIndex] =
      alignTable[0]![columnIndex - 1]! + getInsertCost(baseChildren[columnIndex - 1]!);
  }

  for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
    for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
      const headChild = headChildren[rowIndex - 1]!;
      const baseChild = baseChildren[columnIndex - 1]!;
      const substitutionCost = compareTreeNodes(headChild, baseChild, memo);
      const deletionCost = getDeleteCost(headChild);
      const insertionCost = getInsertCost(baseChild);
      alignTable[rowIndex]![columnIndex] = Math.min(
        alignTable[rowIndex - 1]![columnIndex - 1]! + substitutionCost,
        alignTable[rowIndex - 1]![columnIndex]! + deletionCost,
        alignTable[rowIndex]![columnIndex - 1]! + insertionCost,
      );
    }
  }

  const relabelCost =
    headNode.type === baseNode.type
      ? 0
      : Math.max(getNodeWeight(headNode), getNodeWeight(baseNode)) *
        CHANGE_COMPLEXITY_RELABEL_WEIGHT_FACTOR;
  const essentialChange = relabelCost + alignTable[rowCount]![columnCount]!;
  const nextHeadMemo = memo.get(headNode) ?? new WeakMap<EsTreeNode, number>();
  nextHeadMemo.set(baseNode, essentialChange);
  memo.set(headNode, nextHeadMemo);
  return essentialChange;
};

export const calculateWeightedTreeEditDistance = (
  headNode: EsTreeNode,
  baseNode: EsTreeNode,
): ChangeComplexityTreeEditResult => {
  const headMetrics = measureNodeMetrics(headNode);
  const baseMetrics = measureNodeMetrics(baseNode);
  if (
    headMetrics.nodeCount > CHANGE_COMPLEXITY_MAX_TREE_EDIT_NODE_COUNT ||
    baseMetrics.nodeCount > CHANGE_COMPLEXITY_MAX_TREE_EDIT_NODE_COUNT
  ) {
    return {
      essentialChange: Math.abs(headMetrics.weightedNodeCost - baseMetrics.weightedNodeCost),
      approximate: true,
    };
  }

  const memo = new WeakMap<EsTreeNode, WeakMap<EsTreeNode, number>>();
  return {
    essentialChange: compareTreeNodes(headNode, baseNode, memo),
    approximate: false,
  };
};

export const calculateSubtreeInsertCost = (node: EsTreeNode): number => getInsertCost(node);

export const calculateSubtreeDeleteCost = (node: EsTreeNode): number => getDeleteCost(node);

export const collectChangeComplexityFunctionEntries = (
  program: EsTreeNode,
  sourceText: string,
  relativePath: string,
): ChangeComplexityFunctionEntry[] => {
  const resolvePosition = createComplexityPositionResolver(sourceText);
  return [program, ...collectFunctionNodes(program)].map((functionNode) => {
    const name = functionNode === program ? "<module>" : getFunctionName(functionNode);
    const kind = getFunctionKind(functionNode, name);
    const position = resolvePosition(getNodeStartOffset(functionNode));
    const { start, end } = getNodeRange(functionNode);
    return {
      key: buildComplexityFunctionKey({
        relativePath,
        name,
        kind,
        line: position.line,
      }),
      name,
      kind,
      line: position.line,
      column: position.column,
      node: functionNode,
      sourceText,
      startOffset: start,
      endOffset: end,
    };
  });
};

export const getChangeComplexityFunctionSource = (
  functionEntry: ChangeComplexityFunctionEntry,
): string => getNodeSourceText(functionEntry.node, functionEntry.sourceText);

export const calculateRawLinesChanged = (
  headFunction: ChangeComplexityFunctionEntry,
  baseFunction: ChangeComplexityFunctionEntry,
): number => {
  const headSourceText = getChangeComplexityFunctionSource(headFunction);
  const baseSourceText = getChangeComplexityFunctionSource(baseFunction);
  return calculateLineDiff(baseSourceText, headSourceText).rawLinesChanged;
};

export const calculateBloatRatio = (
  rawLinesChanged: number | null,
  essentialChange: number,
): number | null => {
  if (rawLinesChanged === null) return null;
  return rawLinesChanged / Math.max(essentialChange, 1);
};

export const calculateChangeComplexityScore = (
  essentialChange: number,
  cyclomaticDelta: number,
  cognitiveDelta: number,
  nestingDelta: number,
): number =>
  essentialChange +
  Math.abs(cyclomaticDelta) * CHANGE_COMPLEXITY_CYCLOMATIC_WEIGHT +
  Math.abs(cognitiveDelta) * CHANGE_COMPLEXITY_COGNITIVE_WEIGHT +
  Math.abs(nestingDelta) * CHANGE_COMPLEXITY_NESTING_WEIGHT;

export const calculateChangeEntropy = (
  essentialChanges: ReadonlyArray<number>,
): {
  readonly changeEntropy: number;
  readonly normalizedChangeEntropy: number;
} => {
  const totalEssentialChange = essentialChanges.reduce((sum, value) => sum + value, 0);
  if (essentialChanges.length <= 1 || totalEssentialChange === 0) {
    return { changeEntropy: 0, normalizedChangeEntropy: 0 };
  }

  let changeEntropy = 0;
  for (const essentialChange of essentialChanges) {
    if (essentialChange <= 0) continue;
    const probability = essentialChange / totalEssentialChange;
    changeEntropy -= probability * Math.log2(probability);
  }

  const normalizedChangeEntropy =
    essentialChanges.length > 1 ? changeEntropy / Math.log2(essentialChanges.length) : 0;
  return { changeEntropy, normalizedChangeEntropy };
};
