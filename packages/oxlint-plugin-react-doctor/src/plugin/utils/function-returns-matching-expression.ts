import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const REASSIGNABLE_BINDING_KINDS: ReadonlySet<string> = new Set(["let", "var"]);

const collectReturnedExpressions = (functionNode: EsTreeNode): EsTreeNode[] => {
  if (!isFunctionLike(functionNode) || !functionNode.body) return [];
  if (!isNodeOfType(functionNode.body, "BlockStatement")) return [functionNode.body];
  return collectFunctionReturnStatements(functionNode).flatMap((returnStatement) =>
    returnStatement.argument ? [returnStatement.argument] : [],
  );
};

const getAssignedExpressionForWrite = (writeIdentifier: EsTreeNode): EsTreeNode | null => {
  let assignmentTarget = writeIdentifier;
  let parent = assignmentTarget.parent;
  while (parent && stripParenExpression(parent) === writeIdentifier) {
    assignmentTarget = parent;
    parent = assignmentTarget.parent;
  }
  return parent &&
    isNodeOfType(parent, "AssignmentExpression") &&
    parent.operator === "=" &&
    parent.left === assignmentTarget
    ? parent.right
    : null;
};

const collectAssignedExpressions = (symbol: SymbolDescriptor): EsTreeNode[] => {
  const assignedExpressions = symbol.initializer ? [symbol.initializer] : [];
  if (!REASSIGNABLE_BINDING_KINDS.has(symbol.kind)) return assignedExpressions;
  for (const reference of symbol.references) {
    if (reference.flag === "read") continue;
    const assignedExpression = getAssignedExpressionForWrite(reference.identifier);
    if (assignedExpression) assignedExpressions.push(assignedExpression);
  }
  return assignedExpressions;
};

export const functionReturnsMatchingExpression = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  matchesExpression: (expression: EsTreeNode) => boolean,
): boolean => {
  const visitedExpressions = new Set<EsTreeNode>();
  const visitedFunctions = new Set<EsTreeNode>();

  const functionMatches = (candidateFunction: EsTreeNode): boolean => {
    if (visitedFunctions.has(candidateFunction)) return false;
    visitedFunctions.add(candidateFunction);
    return collectReturnedExpressions(candidateFunction).some(expressionMatches);
  };

  const expressionMatches = (expression: EsTreeNode): boolean => {
    const unwrappedExpression = stripParenExpression(expression);
    if (visitedExpressions.has(unwrappedExpression)) return false;
    visitedExpressions.add(unwrappedExpression);
    if (matchesExpression(unwrappedExpression)) return true;

    if (isNodeOfType(unwrappedExpression, "Identifier")) {
      const symbol = scopes.symbolFor(unwrappedExpression);
      if (!symbol || (symbol.kind !== "const" && !REASSIGNABLE_BINDING_KINDS.has(symbol.kind))) {
        return false;
      }
      return collectAssignedExpressions(symbol).some((assignedExpression) => {
        const assignedValue = stripParenExpression(assignedExpression);
        return !isFunctionLike(assignedValue) && expressionMatches(assignedValue);
      });
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
      return (
        expressionMatches(unwrappedExpression.consequent) ||
        expressionMatches(unwrappedExpression.alternate)
      );
    }
    if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
      return (
        expressionMatches(unwrappedExpression.left) || expressionMatches(unwrappedExpression.right)
      );
    }
    return false;
  };

  return functionMatches(functionNode);
};
