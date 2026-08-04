import ts from "typescript";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { getCanonicalHookName } from "./get-canonical-hook-name.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { isReactHookName } from "./is-react-hook-name.js";
import { ReactObligationStatus, ReactProofClaim } from "./types.js";
import type { ReactAnalysisContext, ReactProofEvidence, ReactProofObligation } from "./types.js";

const containsReturnOutsideNestedFunction = (node: ts.Node): boolean => {
  let didFindReturn = false;
  const visit = (currentNode: ts.Node): void => {
    if (ts.isReturnStatement(currentNode)) {
      didFindReturn = true;
      return;
    }
    if (
      currentNode !== node &&
      (ts.isFunctionDeclaration(currentNode) ||
        ts.isFunctionExpression(currentNode) ||
        ts.isArrowFunction(currentNode))
    ) {
      return;
    }
    currentNode.forEachChild(visit);
  };
  visit(node);
  return didFindReturn;
};

const hasEarlierReturn = (
  callExpression: ts.CallExpression,
  functionNode: ts.FunctionLikeDeclaration,
): boolean => {
  if (!functionNode.body || !ts.isBlock(functionNode.body)) return false;
  const containingStatement = functionNode.body.statements.find(
    (statement) =>
      callExpression.getStart() >= statement.getStart() &&
      callExpression.getEnd() <= statement.getEnd(),
  );
  if (!containingStatement) return false;
  const statementIndex = functionNode.body.statements.indexOf(containingStatement);
  return functionNode.body.statements
    .slice(0, statementIndex)
    .some(containsReturnOutsideNestedFunction);
};

const hasConditionalAncestor = (
  callExpression: ts.CallExpression,
  functionNode: ts.FunctionLikeDeclaration,
): boolean => {
  let currentNode: ts.Node = callExpression;
  while (currentNode !== functionNode) {
    const parentNode = currentNode.parent;
    if (!parentNode) return true;
    if (
      ts.isIfStatement(parentNode) ||
      ts.isConditionalExpression(parentNode) ||
      ts.isForStatement(parentNode) ||
      ts.isForInStatement(parentNode) ||
      ts.isForOfStatement(parentNode) ||
      ts.isWhileStatement(parentNode) ||
      ts.isDoStatement(parentNode) ||
      ts.isCaseClause(parentNode) ||
      ts.isDefaultClause(parentNode) ||
      ts.isTryStatement(parentNode) ||
      ts.isCatchClause(parentNode)
    ) {
      return true;
    }
    if (ts.isBinaryExpression(parentNode)) {
      const operatorKind = parentNode.operatorToken.kind;
      if (
        operatorKind === ts.SyntaxKind.AmpersandAmpersandToken ||
        operatorKind === ts.SyntaxKind.BarBarToken ||
        operatorKind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        return true;
      }
    }
    if (
      parentNode !== functionNode &&
      (ts.isFunctionDeclaration(parentNode) ||
        ts.isFunctionExpression(parentNode) ||
        ts.isArrowFunction(parentNode))
    ) {
      return true;
    }
    currentNode = parentNode;
  }
  return false;
};

const hasTryAncestor = (
  callExpression: ts.CallExpression,
  functionNode: ts.FunctionLikeDeclaration,
): boolean => {
  let currentNode: ts.Node = callExpression;
  while (currentNode !== functionNode) {
    const parentNode = currentNode.parent;
    if (!parentNode) return true;
    if (ts.isTryStatement(parentNode) || ts.isCatchClause(parentNode)) return true;
    currentNode = parentNode;
  }
  return false;
};

export const analyzeHookOrder = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const violations: ReactProofEvidence[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== functionNode && isFunctionBoundary(node)) {
      return;
    }
    if (ts.isCallExpression(node)) {
      const finalCallName = getCanonicalHookName(node, context.typeChecker);
      if (
        finalCallName &&
        isReactHookName(finalCallName) &&
        (finalCallName === "use"
          ? hasTryAncestor(node, functionNode)
          : hasConditionalAncestor(node, functionNode) || hasEarlierReturn(node, functionNode))
      ) {
        const description =
          finalCallName === "use"
            ? "use cannot be called from a try or catch block"
            : `${finalCallName} does not execute in an invariant hook position`;
        violations.push(
          createEvidence(
            node,
            context.rootDirectory,
            description,
            finalCallName === "use"
              ? ["render entry", "try or catch path", "use"]
              : ["render entry", "conditional or early-return path", finalCallName],
          ),
        );
      }
    }
    node.forEachChild(visit);
  };
  functionNode.forEachChild(visit);
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.HookOrder,
      ReactObligationStatus.Violated,
      "Hook order changes across possible renders",
      violations,
    );
  }
  return createObligation(
    ReactProofClaim.HookOrder,
    ReactObligationStatus.Proved,
    "Every discovered hook call has an invariant render position",
  );
};
