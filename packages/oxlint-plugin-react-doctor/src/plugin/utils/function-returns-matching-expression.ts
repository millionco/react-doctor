import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { statementAlwaysExits } from "./statement-always-exits.js";
import { walkAst } from "./walk-ast.js";

const collectReturnedExpressions = (functionNode: EsTreeNode): EsTreeNode[] => {
  if (!isFunctionLike(functionNode)) return [];
  const body = functionNode.body;
  if (!body) return [];
  if (!isNodeOfType(body, "BlockStatement")) return [body];
  const returnedExpressions: EsTreeNode[] = [];
  walkAst(body, (node) => {
    if (
      node !== body &&
      (isFunctionLike(node) ||
        isNodeOfType(node, "ClassDeclaration") ||
        isNodeOfType(node, "ClassExpression"))
    ) {
      return false;
    }
    if (isNodeOfType(node, "ReturnStatement") && node.argument) {
      returnedExpressions.push(node.argument);
    }
  });
  return returnedExpressions;
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

export const functionReturnsMatchingExpression = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  matchesExpression: (expression: EsTreeNode) => boolean,
  matchMode: "some" | "every" = "some",
): boolean => {
  const visitedExpressions = new Set<EsTreeNode>();
  const visitedFunctions = new Set<EsTreeNode>();

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

  const expressionMatches = (expression: EsTreeNode): boolean => {
    const unwrappedExpression = stripParenExpression(expression);
    if (visitedExpressions.has(unwrappedExpression)) return false;
    visitedExpressions.add(unwrappedExpression);
    if (matchesExpression(unwrappedExpression)) return true;

    if (isNodeOfType(unwrappedExpression, "Identifier")) {
      const symbol = scopes.symbolFor(unwrappedExpression);
      if (!symbol || symbol.kind !== "const" || !symbol.initializer) return false;
      const initializer = stripParenExpression(symbol.initializer);
      if (isFunctionLike(initializer)) return false;
      return expressionMatches(initializer);
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

  return functionMatches(functionNode);
};
