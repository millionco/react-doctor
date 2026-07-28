import ts from "typescript";
import { getStaticBooleanValue } from "./get-static-boolean-value.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";

export interface FunctionReturnExpressionDescriptor {
  expression: ts.Expression;
  isConditionallyReached: boolean;
}

export interface FunctionReturnSummary {
  canFallThrough: boolean;
  expressions: ReadonlyArray<FunctionReturnExpressionDescriptor>;
  isComplete: boolean;
}

interface StatementReturnSummary {
  doesAnyPathFallThrough: boolean;
  doesAnyPathReturn: boolean;
  doesAnyPathThrow: boolean;
  expressions: ReadonlyArray<FunctionReturnExpressionDescriptor>;
  isComplete: boolean;
}

const createFallThroughSummary = (): StatementReturnSummary => ({
  doesAnyPathFallThrough: true,
  doesAnyPathReturn: false,
  doesAnyPathThrow: false,
  expressions: [],
  isComplete: true,
});

const isUnsupportedControlFlowStatement = (statement: ts.Statement): boolean =>
  ts.isBreakStatement(statement) ||
  ts.isContinueStatement(statement) ||
  ts.isForInStatement(statement) ||
  ts.isLabeledStatement(statement) ||
  ts.isWithStatement(statement);

const summarizeStatements = (
  statements: ReadonlyArray<ts.Statement>,
  isConditionallyReached: boolean,
  typeChecker: ts.TypeChecker | undefined,
): StatementReturnSummary => {
  const expressions: FunctionReturnExpressionDescriptor[] = [];
  let doesAnyPathFallThrough = true;
  let doesAnyPathReturn = false;
  let doesAnyPathThrow = false;
  let isComplete = true;
  for (const statement of statements) {
    if (!doesAnyPathFallThrough) break;
    const statementSummary = summarizeStatement(
      statement,
      isConditionallyReached || doesAnyPathReturn || doesAnyPathThrow,
      typeChecker,
    );
    expressions.push(...statementSummary.expressions);
    isComplete = isComplete && statementSummary.isComplete;
    doesAnyPathFallThrough = statementSummary.doesAnyPathFallThrough;
    doesAnyPathReturn = doesAnyPathReturn || statementSummary.doesAnyPathReturn;
    doesAnyPathThrow = doesAnyPathThrow || statementSummary.doesAnyPathThrow;
  }
  return {
    doesAnyPathFallThrough,
    doesAnyPathReturn,
    doesAnyPathThrow,
    expressions,
    isComplete,
  };
};

const summarizeIfStatement = (
  statement: ts.IfStatement,
  typeChecker: ts.TypeChecker | undefined,
): StatementReturnSummary => {
  const thenSummary = summarizeStatement(statement.thenStatement, true, typeChecker);
  const elseSummary = statement.elseStatement
    ? summarizeStatement(statement.elseStatement, true, typeChecker)
    : createFallThroughSummary();
  return {
    doesAnyPathFallThrough:
      thenSummary.doesAnyPathFallThrough || elseSummary.doesAnyPathFallThrough,
    doesAnyPathReturn: thenSummary.doesAnyPathReturn || elseSummary.doesAnyPathReturn,
    doesAnyPathThrow: thenSummary.doesAnyPathThrow || elseSummary.doesAnyPathThrow,
    expressions: [...thenSummary.expressions, ...elseSummary.expressions],
    isComplete: thenSummary.isComplete && elseSummary.isComplete,
  };
};

const getLiteralTypeKey = (type: ts.Type, typeChecker: ts.TypeChecker): string | null =>
  type.isLiteral() ? typeChecker.typeToString(type) : null;

const hasExhaustiveSwitchCoverage = (
  statement: ts.SwitchStatement,
  typeChecker: ts.TypeChecker | undefined,
): boolean => {
  if (statement.caseBlock.clauses.some(ts.isDefaultClause)) return true;
  if (!typeChecker) return false;
  const discriminantType = typeChecker.getTypeAtLocation(statement.expression);
  const discriminantMembers = discriminantType.isUnion()
    ? discriminantType.types
    : [discriminantType];
  const discriminantKeys = discriminantMembers.map((member) =>
    getLiteralTypeKey(member, typeChecker),
  );
  if (discriminantKeys.length === 0 || discriminantKeys.some((key) => key === null)) return false;
  const caseKeys = new Set<string>();
  for (const clause of statement.caseBlock.clauses) {
    if (!ts.isCaseClause(clause)) continue;
    const caseType = typeChecker.getTypeAtLocation(clause.expression);
    const caseKey = getLiteralTypeKey(caseType, typeChecker);
    if (!caseKey) return false;
    caseKeys.add(caseKey);
  }
  return discriminantKeys.every((key) => key !== null && caseKeys.has(key));
};

const summarizeSwitchStatement = (
  statement: ts.SwitchStatement,
  typeChecker: ts.TypeChecker | undefined,
): StatementReturnSummary => {
  const clauseSummaries = statement.caseBlock.clauses.map((clause) =>
    summarizeStatements(clause.statements, true, typeChecker),
  );
  const isExhaustive = hasExhaustiveSwitchCoverage(statement, typeChecker);
  return {
    doesAnyPathFallThrough:
      !isExhaustive ||
      clauseSummaries.some((clauseSummary) => clauseSummary.doesAnyPathFallThrough),
    doesAnyPathReturn: clauseSummaries.some((clauseSummary) => clauseSummary.doesAnyPathReturn),
    doesAnyPathThrow: clauseSummaries.some((clauseSummary) => clauseSummary.doesAnyPathThrow),
    expressions: clauseSummaries.flatMap((clauseSummary) => clauseSummary.expressions),
    isComplete:
      clauseSummaries.length > 0 &&
      clauseSummaries.every(
        (clauseSummary) => clauseSummary.isComplete && !clauseSummary.doesAnyPathFallThrough,
      ),
  };
};

const summarizeTryStatement = (
  statement: ts.TryStatement,
  typeChecker: ts.TypeChecker | undefined,
): StatementReturnSummary => {
  const trySummary = summarizeStatements(statement.tryBlock.statements, true, typeChecker);
  const catchSummary = statement.catchClause
    ? summarizeStatements(statement.catchClause.block.statements, true, typeChecker)
    : null;
  const protectedSummary: StatementReturnSummary = catchSummary
    ? {
        doesAnyPathFallThrough:
          trySummary.doesAnyPathFallThrough || catchSummary.doesAnyPathFallThrough,
        doesAnyPathReturn: trySummary.doesAnyPathReturn || catchSummary.doesAnyPathReturn,
        doesAnyPathThrow: catchSummary.doesAnyPathThrow,
        expressions: [...trySummary.expressions, ...catchSummary.expressions],
        isComplete: trySummary.isComplete && catchSummary.isComplete,
      }
    : trySummary;
  if (!statement.finallyBlock) return protectedSummary;
  const finallySummary = summarizeStatements(statement.finallyBlock.statements, true, typeChecker);
  return {
    doesAnyPathFallThrough:
      finallySummary.doesAnyPathFallThrough && protectedSummary.doesAnyPathFallThrough,
    doesAnyPathReturn:
      finallySummary.doesAnyPathReturn ||
      (finallySummary.doesAnyPathFallThrough && protectedSummary.doesAnyPathReturn),
    doesAnyPathThrow:
      finallySummary.doesAnyPathThrow ||
      (finallySummary.doesAnyPathFallThrough && protectedSummary.doesAnyPathThrow),
    expressions: [
      ...(finallySummary.doesAnyPathFallThrough ? protectedSummary.expressions : []),
      ...finallySummary.expressions,
    ],
    isComplete: protectedSummary.isComplete && finallySummary.isComplete,
  };
};

const summarizePreTestLoop = (
  statement: ts.Statement,
  conditionValue: boolean | null,
  typeChecker: ts.TypeChecker | undefined,
): StatementReturnSummary => {
  if (conditionValue === false) return createFallThroughSummary();
  const bodySummary = summarizeStatement(statement, true, typeChecker);
  if (!bodySummary.doesAnyPathFallThrough) {
    return conditionValue === true ? bodySummary : { ...bodySummary, doesAnyPathFallThrough: true };
  }
  return {
    ...bodySummary,
    doesAnyPathFallThrough: conditionValue !== true,
    isComplete: false,
  };
};

const summarizeDoStatement = (
  statement: ts.DoStatement,
  typeChecker: ts.TypeChecker | undefined,
): StatementReturnSummary => {
  const bodySummary = summarizeStatement(statement.statement, true, typeChecker);
  if (!bodySummary.doesAnyPathFallThrough) return bodySummary;
  const conditionValue = getStaticBooleanValue(statement.expression);
  if (conditionValue === false) return bodySummary;
  return {
    ...bodySummary,
    doesAnyPathFallThrough: conditionValue !== true,
    isComplete: false,
  };
};

const summarizeForOfStatement = (
  statement: ts.ForOfStatement,
  typeChecker: ts.TypeChecker | undefined,
): StatementReturnSummary => {
  const iterableExpression = unwrapTypescriptExpression(statement.expression);
  const isFiniteArrayLiteral =
    !statement.awaitModifier &&
    ts.isArrayLiteralExpression(iterableExpression) &&
    iterableExpression.elements.every((element) => !ts.isSpreadElement(element));
  if (isFiniteArrayLiteral && iterableExpression.elements.length === 0) {
    return createFallThroughSummary();
  }
  const bodySummary = summarizeStatement(statement.statement, true, typeChecker);
  return isFiniteArrayLiteral
    ? bodySummary
    : { ...bodySummary, doesAnyPathFallThrough: true, isComplete: false };
};

const summarizeStatement = (
  statement: ts.Statement,
  isConditionallyReached: boolean,
  typeChecker: ts.TypeChecker | undefined,
): StatementReturnSummary => {
  if (ts.isReturnStatement(statement)) {
    return {
      doesAnyPathFallThrough: false,
      doesAnyPathReturn: true,
      doesAnyPathThrow: false,
      expressions: statement.expression
        ? [{ expression: statement.expression, isConditionallyReached }]
        : [],
      isComplete: Boolean(statement.expression),
    };
  }
  if (ts.isThrowStatement(statement)) {
    return {
      doesAnyPathFallThrough: false,
      doesAnyPathReturn: false,
      doesAnyPathThrow: true,
      expressions: [],
      isComplete: true,
    };
  }
  if (ts.isBlock(statement)) {
    return summarizeStatements(statement.statements, isConditionallyReached, typeChecker);
  }
  if (ts.isIfStatement(statement)) return summarizeIfStatement(statement, typeChecker);
  if (ts.isSwitchStatement(statement)) return summarizeSwitchStatement(statement, typeChecker);
  if (ts.isTryStatement(statement)) return summarizeTryStatement(statement, typeChecker);
  if (ts.isWhileStatement(statement)) {
    return summarizePreTestLoop(
      statement.statement,
      getStaticBooleanValue(statement.expression),
      typeChecker,
    );
  }
  if (ts.isDoStatement(statement)) return summarizeDoStatement(statement, typeChecker);
  if (ts.isForStatement(statement)) {
    return summarizePreTestLoop(
      statement.statement,
      statement.condition ? getStaticBooleanValue(statement.condition) : true,
      typeChecker,
    );
  }
  if (ts.isForOfStatement(statement)) return summarizeForOfStatement(statement, typeChecker);
  if (isUnsupportedControlFlowStatement(statement)) {
    return {
      doesAnyPathFallThrough: true,
      doesAnyPathReturn: false,
      doesAnyPathThrow: false,
      expressions: [],
      isComplete: false,
    };
  }
  return createFallThroughSummary();
};

export const summarizeFunctionReturns = (
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker?: ts.TypeChecker,
): FunctionReturnSummary => {
  if (!functionNode.body) {
    return { canFallThrough: true, expressions: [], isComplete: false };
  }
  if (!ts.isBlock(functionNode.body)) {
    return {
      canFallThrough: false,
      expressions: [{ expression: functionNode.body, isConditionallyReached: false }],
      isComplete: true,
    };
  }
  const summary = summarizeStatements(functionNode.body.statements, false, typeChecker);
  return {
    canFallThrough: summary.doesAnyPathFallThrough,
    expressions: summary.expressions,
    isComplete: summary.isComplete && !summary.doesAnyPathThrow,
  };
};
