import { readFileSync } from "node:fs";
import { parseSync } from "oxc-parser";
import type {
  ComplexityConfig,
  DependencyGraph,
  FunctionComplexity,
  SemanticConfidence,
} from "../types.js";
import { computeLineStarts } from "../utils/compute-line-starts.js";
import { offsetToLineColumn } from "../utils/offset-to-line-column.js";
import { isAstNode } from "../utils/is-ast-node.js";

interface FunctionFrame {
  functionName: string;
  startOffset: number;
  endOffset: number;
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  nestingLevel: number;
  lastLogicalOperator: "&&" | "||" | "??" | undefined;
  parameterCount: number;
}

interface VisitState {
  filePath: string;
  lineStarts: number[];
  results: FunctionComplexity[];
  frameStack: FunctionFrame[];
  pendingFunctionName: string | undefined;
}

const incrementCyclomatic = (state: VisitState): void => {
  const topFrame = state.frameStack[state.frameStack.length - 1];
  if (topFrame) topFrame.cyclomaticComplexity++;
};

const incrementCognitiveWithNesting = (state: VisitState): void => {
  const topFrame = state.frameStack[state.frameStack.length - 1];
  if (topFrame) topFrame.cognitiveComplexity += 1 + topFrame.nestingLevel;
};

const incrementCognitiveFlat = (state: VisitState): void => {
  const topFrame = state.frameStack[state.frameStack.length - 1];
  if (topFrame) topFrame.cognitiveComplexity++;
};

const handleLogicalOperator = (operator: "&&" | "||" | "??", state: VisitState): void => {
  const topFrame = state.frameStack[state.frameStack.length - 1];
  if (!topFrame) return;
  if (topFrame.lastLogicalOperator === undefined) {
    topFrame.cognitiveComplexity++;
    topFrame.lastLogicalOperator = operator;
    return;
  }
  if (topFrame.lastLogicalOperator === operator) return;
  topFrame.cognitiveComplexity++;
  topFrame.lastLogicalOperator = operator;
};

const resetLogicalOperator = (state: VisitState): void => {
  const topFrame = state.frameStack[state.frameStack.length - 1];
  if (topFrame) topFrame.lastLogicalOperator = undefined;
};

const incrementNesting = (state: VisitState): void => {
  const topFrame = state.frameStack[state.frameStack.length - 1];
  if (topFrame) topFrame.nestingLevel++;
};

const decrementNesting = (state: VisitState): void => {
  const topFrame = state.frameStack[state.frameStack.length - 1];
  if (topFrame && topFrame.nestingLevel > 0) topFrame.nestingLevel--;
};

const countParameters = (parametersNode: unknown): number => {
  if (!isAstNode(parametersNode)) return 0;
  const params = parametersNode;
  if (Array.isArray(params.params)) {
    return params.params.length;
  }
  if (Array.isArray(params.items)) {
    return params.items.length;
  }
  return 0;
};

const visitChildrenGeneric = (node: unknown, visitor: (child: unknown) => void): void => {
  if (!isAstNode(node)) return;
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") {
      continue;
    }
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) visitor(item);
    } else if (value !== null && typeof value === "object") {
      visitor(value);
    }
  }
};

const pushFunctionFrame = (
  functionName: string,
  startOffset: number,
  endOffset: number,
  parameterCount: number,
  state: VisitState,
): void => {
  state.frameStack.push({
    functionName,
    startOffset,
    endOffset,
    cyclomaticComplexity: 1,
    cognitiveComplexity: 0,
    nestingLevel: 0,
    lastLogicalOperator: undefined,
    parameterCount,
  });
};

const popFunctionFrame = (state: VisitState): void => {
  const completedFrame = state.frameStack.pop();
  if (!completedFrame) return;
  const { line, column } = offsetToLineColumn(completedFrame.startOffset, state.lineStarts);
  const endLine = offsetToLineColumn(completedFrame.endOffset, state.lineStarts).line;
  state.results.push({
    path: state.filePath,
    functionName: completedFrame.functionName,
    line,
    column,
    cyclomatic: completedFrame.cyclomaticComplexity,
    cognitive: completedFrame.cognitiveComplexity,
    lineCount: Math.max(1, endLine - line + 1),
    paramCount: completedFrame.parameterCount,
    confidence: "medium",
    reason: "",
  });
};

const visitFunctionLike = (node: unknown, kind: "function" | "arrow", state: VisitState): void => {
  if (!isAstNode(node)) return;
  const functionName =
    state.pendingFunctionName ??
    (() => {
      const idNode = node.id;
      const idName = isAstNode(idNode) ? idNode.name : undefined;
      return typeof idName === "string" ? idName : kind === "arrow" ? "<arrow>" : "<anonymous>";
    })();
  state.pendingFunctionName = undefined;

  const isNested = state.frameStack.length > 0;
  if (isNested) incrementNesting(state);

  const startOffset = node.start;
  const endOffset = node.end;
  const parameterCount = countParameters(node.params);
  pushFunctionFrame(
    functionName,
    typeof startOffset === "number" ? startOffset : 0,
    typeof endOffset === "number" ? endOffset : 0,
    parameterCount,
    state,
  );

  visitChildrenGeneric(node, (child) => visitNode(child, state));
  popFunctionFrame(state);

  if (isNested) decrementNesting(state);
};

const visitNode = (node: unknown, state: VisitState): void => {
  if (!isAstNode(node)) return;

  switch (node.type) {
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "MethodDefinition":
      if (node.type === "MethodDefinition") {
        const keyNode = node.key;
        const keyName = isAstNode(keyNode) ? (keyNode.name ?? keyNode.value) : undefined;
        if (typeof keyName === "string") state.pendingFunctionName = keyName;
        visitChildrenGeneric(node, (child) => visitNode(child, state));
        state.pendingFunctionName = undefined;
        return;
      }
      visitFunctionLike(node, "function", state);
      return;

    case "ArrowFunctionExpression":
      visitFunctionLike(node, "arrow", state);
      return;

    case "VariableDeclarator": {
      const declaratorId = node.id;
      const declaratorIdName = isAstNode(declaratorId) ? declaratorId.name : undefined;
      if (typeof declaratorIdName === "string") state.pendingFunctionName = declaratorIdName;
      visitChildrenGeneric(node, (child) => visitNode(child, state));
      state.pendingFunctionName = undefined;
      return;
    }

    case "PropertyDefinition": {
      const keyNode = node.key;
      const keyName = isAstNode(keyNode) ? keyNode.name : undefined;
      if (typeof keyName === "string") state.pendingFunctionName = keyName;
      visitChildrenGeneric(node, (child) => visitNode(child, state));
      state.pendingFunctionName = undefined;
      return;
    }

    case "IfStatement":
      incrementCyclomatic(state);
      incrementCognitiveWithNesting(state);
      incrementNesting(state);
      visitChildrenGeneric(node, (child) => visitNode(child, state));
      decrementNesting(state);
      resetLogicalOperator(state);
      return;

    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
      incrementCyclomatic(state);
      incrementCognitiveWithNesting(state);
      incrementNesting(state);
      visitChildrenGeneric(node, (child) => visitNode(child, state));
      decrementNesting(state);
      return;

    case "SwitchCase": {
      const testNode = node.test;
      if (testNode !== null && testNode !== undefined) {
        incrementCyclomatic(state);
        incrementCognitiveFlat(state);
      }
      visitChildrenGeneric(node, (child) => visitNode(child, state));
      return;
    }

    case "CatchClause":
      incrementCyclomatic(state);
      incrementCognitiveWithNesting(state);
      incrementNesting(state);
      visitChildrenGeneric(node, (child) => visitNode(child, state));
      decrementNesting(state);
      return;

    case "ConditionalExpression":
      incrementCyclomatic(state);
      incrementCognitiveWithNesting(state);
      visitChildrenGeneric(node, (child) => visitNode(child, state));
      return;

    case "LogicalExpression": {
      const operator = node.operator;
      if (operator === "&&" || operator === "||" || operator === "??") {
        incrementCyclomatic(state);
        handleLogicalOperator(operator, state);
      }
      visitChildrenGeneric(node, (child) => visitNode(child, state));
      return;
    }

    case "AssignmentExpression": {
      const operator = node.operator;
      if (operator === "&&=" || operator === "||=" || operator === "??=") {
        incrementCyclomatic(state);
      }
      visitChildrenGeneric(node, (child) => visitNode(child, state));
      return;
    }

    case "ChainExpression":
      incrementCyclomatic(state);
      visitChildrenGeneric(node, (child) => visitNode(child, state));
      return;

    default:
      visitChildrenGeneric(node, (child) => visitNode(child, state));
  }
};

const annotateConfidence = (
  finding: FunctionComplexity,
  config: ComplexityConfig,
): { confidence: SemanticConfidence; reason: string } => {
  const breaches: string[] = [];
  if (finding.cyclomatic >= config.cyclomaticThreshold) {
    breaches.push(`cyclomatic ${finding.cyclomatic} ≥ ${config.cyclomaticThreshold}`);
  }
  if (finding.cognitive >= config.cognitiveThreshold) {
    breaches.push(`cognitive ${finding.cognitive} ≥ ${config.cognitiveThreshold}`);
  }
  if (finding.paramCount >= config.paramCountThreshold) {
    breaches.push(`paramCount ${finding.paramCount} ≥ ${config.paramCountThreshold}`);
  }
  if (finding.lineCount >= config.functionLineThreshold) {
    breaches.push(`lineCount ${finding.lineCount} ≥ ${config.functionLineThreshold}`);
  }
  const confidence: SemanticConfidence = breaches.length >= 2 ? "high" : "medium";
  return {
    confidence,
    reason: `${finding.functionName} breaches ${breaches.length} threshold${breaches.length === 1 ? "" : "s"}: ${breaches.join(", ")}`,
  };
};

/**
 * Per-function cyclomatic + cognitive complexity.
 *
 * Cyclomatic (McCabe): 1 + decision points. Counts if/for/while/do/case/catch,
 * the ?: ternary, &&, ||, ??, &&=/||=/??=, and ?. (optional chaining).
 *
 * Cognitive (SonarSource): structural increments with nesting penalty.
 * Operator-sequence rule: a run of the same logical operator is +1 total;
 * each operator change adds another +1.
 *
 * Returns only functions whose metrics breach at least one threshold from
 * `config`. Threshold breach count tunes the `confidence` field.
 */
export const detectComplexHotspots = (
  graph: DependencyGraph,
  config: ComplexityConfig | undefined,
): FunctionComplexity[] => {
  if (!config?.enabled) return [];

  const hotspotFindings: FunctionComplexity[] = [];

  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;
    if (module.isConfigFile) continue;

    let sourceText: string;
    try {
      sourceText = readFileSync(module.fileId.path, "utf-8");
    } catch {
      continue;
    }
    let parseResult: ReturnType<typeof parseSync>;
    try {
      parseResult = parseSync(module.fileId.path, sourceText);
    } catch {
      continue;
    }

    const visitState: VisitState = {
      filePath: module.fileId.path,
      lineStarts: computeLineStarts(sourceText),
      results: [],
      frameStack: [],
      pendingFunctionName: undefined,
    };
    visitNode(parseResult.program, visitState);

    for (const result of visitState.results) {
      const breachesAtLeastOneThreshold =
        result.cyclomatic >= config.cyclomaticThreshold ||
        result.cognitive >= config.cognitiveThreshold ||
        result.paramCount >= config.paramCountThreshold ||
        result.lineCount >= config.functionLineThreshold;
      if (!breachesAtLeastOneThreshold) continue;
      const annotated = annotateConfidence(result, config);
      hotspotFindings.push({
        ...result,
        confidence: annotated.confidence,
        reason: annotated.reason,
      });
    }
  }

  hotspotFindings.sort((leftFinding, rightFinding) => {
    const leftScore = leftFinding.cyclomatic + leftFinding.cognitive;
    const rightScore = rightFinding.cyclomatic + rightFinding.cognitive;
    if (leftScore !== rightScore) return rightScore - leftScore;
    if (leftFinding.path !== rightFinding.path)
      return leftFinding.path.localeCompare(rightFinding.path);
    return leftFinding.line - rightFinding.line;
  });

  return hotspotFindings;
};
