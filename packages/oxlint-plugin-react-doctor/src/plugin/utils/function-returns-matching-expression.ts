import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { ControlFlowAnalysis } from "../semantic/control-flow-graph.js";
import { collectPossibleAssignedExpressions } from "./collect-possible-assigned-expressions.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { statementAlwaysExits } from "./statement-always-exits.js";
import { walkAst } from "./walk-ast.js";

const REASSIGNABLE_BINDING_KINDS: ReadonlySet<string> = new Set(["let", "var"]);

const collectReturnedExpressions = (functionNode: EsTreeNode): EsTreeNode[] => {
  if (!isFunctionLike(functionNode) || !functionNode.body) return [];
  if (!isNodeOfType(functionNode.body, "BlockStatement")) return [functionNode.body];
  return collectFunctionReturnStatements(functionNode).flatMap((returnStatement) =>
    returnStatement.argument ? [returnStatement.argument] : [],
  );
};

const functionHasBareReturn = (functionNode: EsTreeNode): boolean => {
  if (!isFunctionLike(functionNode) || !isNodeOfType(functionNode.body, "BlockStatement")) {
    return false;
  }
  let didFindBareReturn = false;
  walkAst(functionNode.body, (node) => {
    if (didFindBareReturn) return false;
    if (node !== functionNode.body && isFunctionLike(node)) return false;
    if (isNodeOfType(node, "ReturnStatement") && !node.argument) didFindBareReturn = true;
  });
  return didFindBareReturn;
};

interface FunctionReturnMatcher {
  readonly expressionMatches: (expression: EsTreeNode) => boolean;
  readonly functionMatches: (candidateFunction: EsTreeNode) => boolean;
}

const createFunctionReturnMatcher = (
  scopes: ScopeAnalysis,
  matchesExpression: (expression: EsTreeNode) => boolean,
  controlFlow?: ControlFlowAnalysis,
  matchMode: "some" | "every" = "some",
): FunctionReturnMatcher => {
  const visitedExpressions = new Set<EsTreeNode>();
  const visitedFunctions = new Set<EsTreeNode>();
  let expressionMatches: (expression: EsTreeNode) => boolean;

  const functionMatches = (candidateFunction: EsTreeNode): boolean => {
    if (visitedFunctions.has(candidateFunction)) return false;
    visitedFunctions.add(candidateFunction);
    const returnedExpressions = collectReturnedExpressions(candidateFunction);
    if (
      matchMode === "every" &&
      isFunctionLike(candidateFunction) &&
      isNodeOfType(candidateFunction.body, "BlockStatement") &&
      (!statementAlwaysExits(candidateFunction.body) || functionHasBareReturn(candidateFunction))
    ) {
      return false;
    }
    return (
      returnedExpressions.length > 0 &&
      (matchMode === "every"
        ? returnedExpressions.every(expressionMatches)
        : returnedExpressions.some(expressionMatches))
    );
  };

  expressionMatches = (expression: EsTreeNode): boolean => {
    const unwrappedExpression = stripParenExpression(expression);
    if (visitedExpressions.has(unwrappedExpression)) return false;
    visitedExpressions.add(unwrappedExpression);
    if (matchesExpression(unwrappedExpression)) return true;

    if (isNodeOfType(unwrappedExpression, "Identifier")) {
      const symbol = scopes.symbolFor(unwrappedExpression);
      if (!symbol || (symbol.kind !== "const" && !REASSIGNABLE_BINDING_KINDS.has(symbol.kind))) {
        return false;
      }
      return collectPossibleAssignedExpressions(symbol, unwrappedExpression, controlFlow).some(
        (assignedExpression) => {
          const assignedValue = stripParenExpression(assignedExpression);
          return !isFunctionLike(assignedValue) && expressionMatches(assignedValue);
        },
      );
    }

    if (isNodeOfType(unwrappedExpression, "CallExpression")) {
      if (unwrappedExpression.arguments.length !== 0) return false;
      if (!isNodeOfType(unwrappedExpression.callee, "Identifier")) return false;
      const symbol = scopes.symbolFor(unwrappedExpression.callee);
      if (!symbol || (symbol.kind !== "const" && symbol.kind !== "function")) return false;
      const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
      const candidateFunction = isFunctionLike(initializer)
        ? initializer
        : isFunctionLike(symbol.declarationNode)
          ? symbol.declarationNode
          : null;
      if (
        !candidateFunction ||
        candidateFunction.async ||
        candidateFunction.generator ||
        candidateFunction.params.length !== 0
      ) {
        return false;
      }
      return functionMatches(candidateFunction);
    }

    if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
      return branchesMatch(unwrappedExpression.consequent, unwrappedExpression.alternate);
    }
    if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
      return branchesMatch(unwrappedExpression.left, unwrappedExpression.right);
    }
    return false;
  };

  const branchesMatch = (firstBranch: EsTreeNode, secondBranch: EsTreeNode): boolean => {
    const didBranchMatch = [expressionMatches(firstBranch), expressionMatches(secondBranch)];
    return matchMode === "every" ? didBranchMatch.every(Boolean) : didBranchMatch.some(Boolean);
  };

  return { expressionMatches, functionMatches };
};

export const functionReturnsMatchingExpression = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  matchesExpression: (expression: EsTreeNode) => boolean,
  controlFlow?: ControlFlowAnalysis,
  matchMode: "some" | "every" = "some",
): boolean =>
  createFunctionReturnMatcher(scopes, matchesExpression, controlFlow, matchMode).functionMatches(
    functionNode,
  );

export const functionReturnsMatchingExpressionOnEveryPathAfterNode = (
  functionNode: EsTreeNode,
  pathStartNode: EsTreeNode,
  scopes: ScopeAnalysis,
  matchesExpression: (expression: EsTreeNode) => boolean,
  controlFlow: ControlFlowAnalysis,
): boolean => {
  const functionControlFlow = controlFlow.cfgFor(functionNode);
  const startBlock = functionControlFlow?.blockOf(pathStartNode);
  if (!functionControlFlow || !startBlock) return false;
  const matchingReturnBlocks = new Set(
    collectFunctionReturnStatements(functionNode).flatMap((returnStatement) => {
      if (!returnStatement.argument) return [];
      const matcher = createFunctionReturnMatcher(scopes, matchesExpression, controlFlow, "every");
      if (!matcher.expressionMatches(returnStatement.argument)) return [];
      const returnBlock = functionControlFlow.blockOf(returnStatement.argument);
      return returnBlock ? [returnBlock] : [];
    }),
  );
  if (matchingReturnBlocks.size === 0) return false;
  const visitedBlocks = new Set([startBlock]);
  const pendingBlocks = [startBlock];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock) break;
    if (matchingReturnBlocks.has(currentBlock)) continue;
    for (const edge of currentBlock.successors) {
      if (edge.to === functionControlFlow.exit) return false;
      if (visitedBlocks.has(edge.to)) continue;
      visitedBlocks.add(edge.to);
      pendingBlocks.push(edge.to);
    }
  }
  return true;
};
