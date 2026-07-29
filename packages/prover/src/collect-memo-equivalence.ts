import ts from "typescript";
import { MAX_MEMO_COMPARATOR_PATHS } from "./constants.js";
import { getCanonicalReactApiName } from "./get-canonical-react-api-name.js";
import { getNodeLocation } from "./get-node-location.js";
import { isIdentifierReference } from "./is-identifier-reference.js";
import { resolveFunction } from "./resolve-function.js";
import { ReactMemoComparatorKind, ReactMemoComparatorStatus } from "./types.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";
import { createSemanticId } from "./utils/create-semantic-id.js";
import { isMemoObservationCovered } from "./utils/is-memo-observation-covered.js";
import { resolveAliasedSymbol } from "./utils/resolve-aliased-symbol.js";
import type {
  ReactAnalysisContext,
  ReactSemanticMemoComparator,
  ReactSemanticMemoComparatorTruePath,
  ReactSemanticMemoPropObservation,
  ReactSemanticUnit,
  ReactUnitDescriptor,
} from "./types.js";

enum MemoPropSide {
  Next = "next",
  Previous = "previous",
}

interface MemoPropBinding {
  side: MemoPropSide;
  path: string;
  isRest: boolean;
}

interface ComponentPropBinding {
  path: string;
  isRest: boolean;
}

interface LogicalComparatorPath {
  equalPropPaths: Set<string>;
  unequalPropPaths: Set<string>;
  sourceComplete: boolean;
}

interface LogicalPathCollection {
  paths: ReadonlyArray<LogicalComparatorPath>;
  complete: boolean;
}

interface BooleanComparatorBranches {
  whenTrue: ReadonlyArray<LogicalComparatorPath>;
  whenFalse: ReadonlyArray<LogicalComparatorPath>;
  complete: boolean;
}

interface ComparatorStatementResult {
  continuingPaths: ReadonlyArray<LogicalComparatorPath>;
  truePaths: ReadonlyArray<LogicalComparatorPath>;
  complete: boolean;
}

interface ComparatorAnalysis {
  truePaths: ReadonlyArray<ReactSemanticMemoComparatorTruePath>;
  complete: boolean;
}

interface ComponentObservationAnalysis {
  observations: ReadonlyArray<ReactSemanticMemoPropObservation>;
  complete: boolean;
}

const createLogicalPath = (sourceComplete = true): LogicalComparatorPath => ({
  equalPropPaths: new Set(),
  unequalPropPaths: new Set(),
  sourceComplete,
});

const logicalPathIdentity = (path: LogicalComparatorPath): string =>
  [
    Array.from(path.equalPropPaths).toSorted().join(","),
    Array.from(path.unequalPropPaths).toSorted().join(","),
    String(path.sourceComplete),
  ].join("|");

const limitLogicalPaths = (paths: ReadonlyArray<LogicalComparatorPath>): LogicalPathCollection => {
  const uniquePaths = new Map<string, LogicalComparatorPath>();
  for (const path of paths) {
    uniquePaths.set(logicalPathIdentity(path), path);
  }
  if (uniquePaths.size <= MAX_MEMO_COMPARATOR_PATHS) {
    return { paths: [...uniquePaths.values()], complete: true };
  }
  return {
    paths: [createLogicalPath(false)],
    complete: false,
  };
};

const mergeLogicalPaths = (
  leftPath: LogicalComparatorPath,
  rightPath: LogicalComparatorPath,
): LogicalComparatorPath | null => {
  for (const equalPropPath of leftPath.equalPropPaths) {
    if (rightPath.unequalPropPaths.has(equalPropPath)) return null;
  }
  for (const unequalPropPath of leftPath.unequalPropPaths) {
    if (rightPath.equalPropPaths.has(unequalPropPath)) return null;
  }
  return {
    equalPropPaths: new Set([...leftPath.equalPropPaths, ...rightPath.equalPropPaths]),
    unequalPropPaths: new Set([...leftPath.unequalPropPaths, ...rightPath.unequalPropPaths]),
    sourceComplete: leftPath.sourceComplete && rightPath.sourceComplete,
  };
};

const combineLogicalPaths = (
  leftPaths: ReadonlyArray<LogicalComparatorPath>,
  rightPaths: ReadonlyArray<LogicalComparatorPath>,
): LogicalPathCollection => {
  const combinedPaths: LogicalComparatorPath[] = [];
  for (const leftPath of leftPaths) {
    for (const rightPath of rightPaths) {
      const combinedPath = mergeLogicalPaths(leftPath, rightPath);
      if (combinedPath) combinedPaths.push(combinedPath);
    }
  }
  return limitLogicalPaths(combinedPaths);
};

const getStaticPropertyName = (name: ts.PropertyName): string | null => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (
    ts.isComputedPropertyName(name) &&
    (ts.isStringLiteral(name.expression) || ts.isNumericLiteral(name.expression))
  ) {
    return name.expression.text;
  }
  return null;
};

const appendPropPath = (prefix: string, propertyName: string): string =>
  prefix.length === 0 ? propertyName : `${prefix}.${propertyName}`;

const bindComparatorPattern = (
  bindingName: ts.BindingName,
  side: MemoPropSide,
  prefix: string,
  bindings: Map<ts.Symbol, MemoPropBinding>,
  typeChecker: ts.TypeChecker,
): boolean => {
  if (ts.isIdentifier(bindingName)) {
    const symbol = typeChecker.getSymbolAtLocation(bindingName);
    if (!symbol) return false;
    bindings.set(resolveAliasedSymbol(symbol, typeChecker), {
      side,
      path: prefix,
      isRest: false,
    });
    return true;
  }
  if (!ts.isObjectBindingPattern(bindingName)) return false;
  let complete = true;
  for (const element of bindingName.elements) {
    const propertyName = element.propertyName
      ? getStaticPropertyName(element.propertyName)
      : ts.isIdentifier(element.name)
        ? element.name.text
        : null;
    if (element.dotDotDotToken) {
      if (!ts.isIdentifier(element.name)) {
        complete = false;
        continue;
      }
      const symbol = typeChecker.getSymbolAtLocation(element.name);
      if (!symbol) {
        complete = false;
        continue;
      }
      bindings.set(resolveAliasedSymbol(symbol, typeChecker), {
        side,
        path: prefix,
        isRest: true,
      });
      continue;
    }
    if (!propertyName) {
      complete = false;
      continue;
    }
    complete =
      bindComparatorPattern(
        element.name,
        side,
        appendPropPath(prefix, propertyName),
        bindings,
        typeChecker,
      ) && complete;
  }
  return complete;
};

const getComparatorPropBinding = (
  expression: ts.Expression,
  bindings: ReadonlyMap<ts.Symbol, MemoPropBinding>,
  typeChecker: ts.TypeChecker,
): MemoPropBinding | null => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (ts.isIdentifier(unwrappedExpression)) {
    const symbol = typeChecker.getSymbolAtLocation(unwrappedExpression);
    return symbol ? (bindings.get(resolveAliasedSymbol(symbol, typeChecker)) ?? null) : null;
  }
  if (ts.isPropertyAccessExpression(unwrappedExpression)) {
    const parentBinding = getComparatorPropBinding(
      unwrappedExpression.expression,
      bindings,
      typeChecker,
    );
    return parentBinding && !parentBinding.isRest
      ? {
          ...parentBinding,
          path: appendPropPath(parentBinding.path, unwrappedExpression.name.text),
        }
      : null;
  }
  if (ts.isElementAccessExpression(unwrappedExpression)) {
    const argumentExpression = unwrappedExpression.argumentExpression;
    if (
      !argumentExpression ||
      (!ts.isStringLiteral(argumentExpression) && !ts.isNumericLiteral(argumentExpression))
    ) {
      return null;
    }
    const parentBinding = getComparatorPropBinding(
      unwrappedExpression.expression,
      bindings,
      typeChecker,
    );
    return parentBinding && !parentBinding.isRest
      ? {
          ...parentBinding,
          path: appendPropPath(parentBinding.path, argumentExpression.text),
        }
      : null;
  }
  return null;
};

const getComparedPropPath = (
  leftExpression: ts.Expression,
  rightExpression: ts.Expression,
  bindings: ReadonlyMap<ts.Symbol, MemoPropBinding>,
  typeChecker: ts.TypeChecker,
): string | null => {
  const leftBinding = getComparatorPropBinding(leftExpression, bindings, typeChecker);
  const rightBinding = getComparatorPropBinding(rightExpression, bindings, typeChecker);
  if (
    !leftBinding ||
    !rightBinding ||
    leftBinding.isRest ||
    rightBinding.isRest ||
    leftBinding.path !== rightBinding.path ||
    leftBinding.side === rightBinding.side
  ) {
    return null;
  }
  return leftBinding.path;
};

const isDefaultLibrarySymbol = (
  symbol: ts.Symbol | undefined,
  context: ReactAnalysisContext,
): boolean =>
  Boolean(
    symbol?.declarations?.length &&
    symbol.declarations.every((declaration) =>
      context.program.isSourceFileDefaultLibrary(declaration.getSourceFile()),
    ),
  );

const getObjectIsComparedPropPath = (
  callExpression: ts.CallExpression,
  bindings: ReadonlyMap<ts.Symbol, MemoPropBinding>,
  context: ReactAnalysisContext,
): string | null => {
  if (
    callExpression.arguments.length !== 2 ||
    !ts.isPropertyAccessExpression(callExpression.expression) ||
    !ts.isIdentifier(callExpression.expression.expression) ||
    callExpression.expression.expression.text !== "Object" ||
    callExpression.expression.name.text !== "is" ||
    !isDefaultLibrarySymbol(
      context.typeChecker.getSymbolAtLocation(callExpression.expression.expression),
      context,
    )
  ) {
    return null;
  }
  const leftExpression = callExpression.arguments[0];
  const rightExpression = callExpression.arguments[1];
  return leftExpression && rightExpression
    ? getComparedPropPath(leftExpression, rightExpression, bindings, context.typeChecker)
    : null;
};

const equalityBranches = (
  propPath: string,
  equalityWhenTrue: boolean,
): BooleanComparatorBranches => {
  const equalPath = createLogicalPath();
  equalPath.equalPropPaths.add(propPath);
  const unequalPath = createLogicalPath();
  unequalPath.unequalPropPaths.add(propPath);
  return equalityWhenTrue
    ? { whenTrue: [equalPath], whenFalse: [unequalPath], complete: true }
    : { whenTrue: [unequalPath], whenFalse: [equalPath], complete: true };
};

const unknownBooleanBranches = (): BooleanComparatorBranches => ({
  whenTrue: [createLogicalPath(false)],
  whenFalse: [createLogicalPath(false)],
  complete: false,
});

const evaluateBooleanExpression = (
  expression: ts.Expression,
  bindings: ReadonlyMap<ts.Symbol, MemoPropBinding>,
  context: ReactAnalysisContext,
  visitedSymbols: Set<ts.Symbol>,
): BooleanComparatorBranches => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (unwrappedExpression.kind === ts.SyntaxKind.TrueKeyword) {
    return {
      whenTrue: [createLogicalPath()],
      whenFalse: [],
      complete: true,
    };
  }
  if (unwrappedExpression.kind === ts.SyntaxKind.FalseKeyword) {
    return {
      whenTrue: [],
      whenFalse: [createLogicalPath()],
      complete: true,
    };
  }
  if (
    ts.isPrefixUnaryExpression(unwrappedExpression) &&
    unwrappedExpression.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const operandBranches = evaluateBooleanExpression(
      unwrappedExpression.operand,
      bindings,
      context,
      visitedSymbols,
    );
    return {
      whenTrue: operandBranches.whenFalse,
      whenFalse: operandBranches.whenTrue,
      complete: operandBranches.complete,
    };
  }
  if (ts.isBinaryExpression(unwrappedExpression)) {
    const operatorKind = unwrappedExpression.operatorToken.kind;
    if (
      operatorKind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      operatorKind === ts.SyntaxKind.ExclamationEqualsEqualsToken
    ) {
      const propPath = getComparedPropPath(
        unwrappedExpression.left,
        unwrappedExpression.right,
        bindings,
        context.typeChecker,
      );
      return propPath === null
        ? unknownBooleanBranches()
        : equalityBranches(propPath, operatorKind === ts.SyntaxKind.EqualsEqualsEqualsToken);
    }
    if (
      operatorKind === ts.SyntaxKind.AmpersandAmpersandToken ||
      operatorKind === ts.SyntaxKind.BarBarToken
    ) {
      const leftBranches = evaluateBooleanExpression(
        unwrappedExpression.left,
        bindings,
        context,
        visitedSymbols,
      );
      const rightBranches = evaluateBooleanExpression(
        unwrappedExpression.right,
        bindings,
        context,
        visitedSymbols,
      );
      if (operatorKind === ts.SyntaxKind.AmpersandAmpersandToken) {
        const trueCombination = combineLogicalPaths(leftBranches.whenTrue, rightBranches.whenTrue);
        const falseRightCombination = combineLogicalPaths(
          leftBranches.whenTrue,
          rightBranches.whenFalse,
        );
        const falseCombination = limitLogicalPaths([
          ...leftBranches.whenFalse,
          ...falseRightCombination.paths,
        ]);
        return {
          whenTrue: trueCombination.paths,
          whenFalse: falseCombination.paths,
          complete:
            leftBranches.complete &&
            rightBranches.complete &&
            trueCombination.complete &&
            falseRightCombination.complete &&
            falseCombination.complete,
        };
      }
      const trueRightCombination = combineLogicalPaths(
        leftBranches.whenFalse,
        rightBranches.whenTrue,
      );
      const trueCombination = limitLogicalPaths([
        ...leftBranches.whenTrue,
        ...trueRightCombination.paths,
      ]);
      const falseCombination = combineLogicalPaths(leftBranches.whenFalse, rightBranches.whenFalse);
      return {
        whenTrue: trueCombination.paths,
        whenFalse: falseCombination.paths,
        complete:
          leftBranches.complete &&
          rightBranches.complete &&
          trueRightCombination.complete &&
          trueCombination.complete &&
          falseCombination.complete,
      };
    }
  }
  if (ts.isCallExpression(unwrappedExpression)) {
    const propPath = getObjectIsComparedPropPath(unwrappedExpression, bindings, context);
    return propPath === null ? unknownBooleanBranches() : equalityBranches(propPath, true);
  }
  if (ts.isConditionalExpression(unwrappedExpression)) {
    const conditionBranches = evaluateBooleanExpression(
      unwrappedExpression.condition,
      bindings,
      context,
      visitedSymbols,
    );
    const trueExpressionBranches = evaluateBooleanExpression(
      unwrappedExpression.whenTrue,
      bindings,
      context,
      visitedSymbols,
    );
    const falseExpressionBranches = evaluateBooleanExpression(
      unwrappedExpression.whenFalse,
      bindings,
      context,
      visitedSymbols,
    );
    const trueConditionTrueResult = combineLogicalPaths(
      conditionBranches.whenTrue,
      trueExpressionBranches.whenTrue,
    );
    const falseConditionTrueResult = combineLogicalPaths(
      conditionBranches.whenFalse,
      falseExpressionBranches.whenTrue,
    );
    const truePaths = limitLogicalPaths([
      ...trueConditionTrueResult.paths,
      ...falseConditionTrueResult.paths,
    ]);
    const trueConditionFalseResult = combineLogicalPaths(
      conditionBranches.whenTrue,
      trueExpressionBranches.whenFalse,
    );
    const falseConditionFalseResult = combineLogicalPaths(
      conditionBranches.whenFalse,
      falseExpressionBranches.whenFalse,
    );
    const falsePaths = limitLogicalPaths([
      ...trueConditionFalseResult.paths,
      ...falseConditionFalseResult.paths,
    ]);
    return {
      whenTrue: truePaths.paths,
      whenFalse: falsePaths.paths,
      complete:
        conditionBranches.complete &&
        trueExpressionBranches.complete &&
        falseExpressionBranches.complete &&
        trueConditionTrueResult.complete &&
        falseConditionTrueResult.complete &&
        trueConditionFalseResult.complete &&
        falseConditionFalseResult.complete &&
        truePaths.complete &&
        falsePaths.complete,
    };
  }
  if (ts.isIdentifier(unwrappedExpression)) {
    const unresolvedSymbol = context.typeChecker.getSymbolAtLocation(unwrappedExpression);
    if (!unresolvedSymbol) return unknownBooleanBranches();
    const symbol = resolveAliasedSymbol(unresolvedSymbol, context.typeChecker);
    if (visitedSymbols.has(symbol)) return unknownBooleanBranches();
    visitedSymbols.add(symbol);
    for (const declaration of symbol.declarations ?? []) {
      if (
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        declaration.parent.flags & ts.NodeFlags.Const
      ) {
        return evaluateBooleanExpression(
          declaration.initializer,
          bindings,
          context,
          visitedSymbols,
        );
      }
    }
  }
  return unknownBooleanBranches();
};

const markPathsIncomplete = (
  paths: ReadonlyArray<LogicalComparatorPath>,
): ReadonlyArray<LogicalComparatorPath> =>
  paths.map((path) => ({
    equalPropPaths: new Set(path.equalPropPaths),
    unequalPropPaths: new Set(path.unequalPropPaths),
    sourceComplete: false,
  }));

const analyzeComparatorStatement = (
  statement: ts.Statement,
  activePaths: ReadonlyArray<LogicalComparatorPath>,
  bindings: ReadonlyMap<ts.Symbol, MemoPropBinding>,
  context: ReactAnalysisContext,
): ComparatorStatementResult => {
  if (ts.isBlock(statement)) {
    return analyzeComparatorStatements(statement.statements, activePaths, bindings, context);
  }
  if (ts.isReturnStatement(statement)) {
    if (!statement.expression) {
      return { continuingPaths: [], truePaths: [], complete: true };
    }
    const returnBranches = evaluateBooleanExpression(
      statement.expression,
      bindings,
      context,
      new Set(),
    );
    const trueCombination = combineLogicalPaths(activePaths, returnBranches.whenTrue);
    return {
      continuingPaths: [],
      truePaths: trueCombination.paths,
      complete: returnBranches.complete && trueCombination.complete,
    };
  }
  if (ts.isIfStatement(statement)) {
    const conditionBranches = evaluateBooleanExpression(
      statement.expression,
      bindings,
      context,
      new Set(),
    );
    const trueCombination = combineLogicalPaths(activePaths, conditionBranches.whenTrue);
    const falseCombination = combineLogicalPaths(activePaths, conditionBranches.whenFalse);
    const thenResult = analyzeComparatorStatement(
      statement.thenStatement,
      trueCombination.paths,
      bindings,
      context,
    );
    const elseResult = statement.elseStatement
      ? analyzeComparatorStatement(
          statement.elseStatement,
          falseCombination.paths,
          bindings,
          context,
        )
      : {
          continuingPaths: falseCombination.paths,
          truePaths: [],
          complete: true,
        };
    const continuingPaths = limitLogicalPaths([
      ...thenResult.continuingPaths,
      ...elseResult.continuingPaths,
    ]);
    const truePaths = limitLogicalPaths([...thenResult.truePaths, ...elseResult.truePaths]);
    return {
      continuingPaths: continuingPaths.paths,
      truePaths: truePaths.paths,
      complete:
        conditionBranches.complete &&
        trueCombination.complete &&
        falseCombination.complete &&
        thenResult.complete &&
        elseResult.complete &&
        continuingPaths.complete &&
        truePaths.complete,
    };
  }
  if (ts.isVariableStatement(statement) || ts.isEmptyStatement(statement)) {
    return { continuingPaths: activePaths, truePaths: [], complete: true };
  }
  if (ts.isThrowStatement(statement)) {
    return { continuingPaths: [], truePaths: [], complete: false };
  }
  return {
    continuingPaths: markPathsIncomplete(activePaths),
    truePaths: [],
    complete: false,
  };
};

const analyzeComparatorStatements = (
  statements: ReadonlyArray<ts.Statement>,
  initialPaths: ReadonlyArray<LogicalComparatorPath>,
  bindings: ReadonlyMap<ts.Symbol, MemoPropBinding>,
  context: ReactAnalysisContext,
): ComparatorStatementResult => {
  let continuingPaths = initialPaths;
  const truePaths: LogicalComparatorPath[] = [];
  let complete = true;
  for (const statement of statements) {
    if (continuingPaths.length === 0) break;
    const statementResult = analyzeComparatorStatement(
      statement,
      continuingPaths,
      bindings,
      context,
    );
    continuingPaths = statementResult.continuingPaths;
    truePaths.push(...statementResult.truePaths);
    complete = complete && statementResult.complete;
  }
  const limitedTruePaths = limitLogicalPaths(truePaths);
  return {
    continuingPaths,
    truePaths: limitedTruePaths.paths,
    complete: complete && limitedTruePaths.complete,
  };
};

const analyzeComparator = (
  comparator: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ComparatorAnalysis => {
  const previousParameter = comparator.parameters[0];
  const nextParameter = comparator.parameters[1];
  if (comparator.parameters.length > 2) {
    return {
      truePaths: [{ equalPropPaths: [], sourceComplete: false }],
      complete: false,
    };
  }
  const bindings = new Map<ts.Symbol, MemoPropBinding>();
  const bindingsComplete =
    Boolean(previousParameter) &&
    Boolean(nextParameter) &&
    bindComparatorPattern(
      previousParameter.name,
      MemoPropSide.Previous,
      "",
      bindings,
      context.typeChecker,
    ) &&
    bindComparatorPattern(nextParameter.name, MemoPropSide.Next, "", bindings, context.typeChecker);
  if (!comparator.body) {
    return {
      truePaths: [{ equalPropPaths: [], sourceComplete: false }],
      complete: false,
    };
  }
  const statementResult = ts.isBlock(comparator.body)
    ? analyzeComparatorStatements(
        comparator.body.statements,
        [createLogicalPath()],
        bindings,
        context,
      )
    : (() => {
        const expressionBranches = evaluateBooleanExpression(
          comparator.body,
          bindings,
          context,
          new Set(),
        );
        return {
          continuingPaths: [],
          truePaths: expressionBranches.whenTrue,
          complete: expressionBranches.complete,
        };
      })();
  return {
    truePaths: statementResult.truePaths.map((path) => ({
      equalPropPaths: Array.from(path.equalPropPaths).toSorted(),
      sourceComplete: path.sourceComplete,
    })),
    complete:
      statementResult.complete &&
      statementResult.truePaths.every((path) => path.sourceComplete) &&
      (bindingsComplete || statementResult.truePaths.length === 0),
  };
};

const bindComponentPattern = (
  bindingName: ts.BindingName,
  prefix: string,
  isRest: boolean,
  bindings: Map<ts.Symbol, ComponentPropBinding>,
  typeChecker: ts.TypeChecker,
): boolean => {
  if (ts.isIdentifier(bindingName)) {
    const symbol = typeChecker.getSymbolAtLocation(bindingName);
    if (!symbol) return false;
    bindings.set(resolveAliasedSymbol(symbol, typeChecker), {
      path: prefix,
      isRest,
    });
    return true;
  }
  if (!ts.isObjectBindingPattern(bindingName)) return false;
  let complete = true;
  for (const element of bindingName.elements) {
    if (element.dotDotDotToken) {
      complete =
        bindComponentPattern(element.name, prefix, true, bindings, typeChecker) && complete;
      continue;
    }
    const propertyName = element.propertyName
      ? getStaticPropertyName(element.propertyName)
      : ts.isIdentifier(element.name)
        ? element.name.text
        : null;
    if (!propertyName) {
      complete = false;
      continue;
    }
    complete =
      bindComponentPattern(
        element.name,
        appendPropPath(prefix, propertyName),
        false,
        bindings,
        typeChecker,
      ) && complete;
  }
  return complete;
};

const getComponentPropBinding = (
  expression: ts.Expression,
  bindings: ReadonlyMap<ts.Symbol, ComponentPropBinding>,
  typeChecker: ts.TypeChecker,
): ComponentPropBinding | null => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (ts.isIdentifier(unwrappedExpression)) {
    const symbol = typeChecker.getSymbolAtLocation(unwrappedExpression);
    return symbol ? (bindings.get(resolveAliasedSymbol(symbol, typeChecker)) ?? null) : null;
  }
  if (ts.isPropertyAccessExpression(unwrappedExpression)) {
    const parentBinding = getComponentPropBinding(
      unwrappedExpression.expression,
      bindings,
      typeChecker,
    );
    return parentBinding && !parentBinding.isRest
      ? {
          path: appendPropPath(parentBinding.path, unwrappedExpression.name.text),
          isRest: false,
        }
      : null;
  }
  if (ts.isElementAccessExpression(unwrappedExpression)) {
    const argumentExpression = unwrappedExpression.argumentExpression;
    if (
      !argumentExpression ||
      (!ts.isStringLiteral(argumentExpression) && !ts.isNumericLiteral(argumentExpression))
    ) {
      return null;
    }
    const parentBinding = getComponentPropBinding(
      unwrappedExpression.expression,
      bindings,
      typeChecker,
    );
    return parentBinding && !parentBinding.isRest
      ? {
          path: appendPropPath(parentBinding.path, argumentExpression.text),
          isRest: false,
        }
      : null;
  }
  return null;
};

const canTypeVary = (type: ts.Type): boolean => {
  if (type.flags & ts.TypeFlags.Never) return false;
  if (type.isUnion()) {
    const possibleTypes = type.types.filter(
      (possibleType) => !(possibleType.flags & ts.TypeFlags.Never),
    );
    if (possibleTypes.length > 1) return true;
    const onlyPossibleType = possibleTypes[0];
    return onlyPossibleType ? canTypeVary(onlyPossibleType) : false;
  }
  return (
    (type.flags &
      (ts.TypeFlags.StringLiteral |
        ts.TypeFlags.NumberLiteral |
        ts.TypeFlags.BigIntLiteral |
        ts.TypeFlags.BooleanLiteral |
        ts.TypeFlags.Null |
        ts.TypeFlags.Undefined |
        ts.TypeFlags.Void |
        ts.TypeFlags.UniqueESSymbol)) ===
    0
  );
};

const isOutermostPropertyExpression = (
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): boolean => {
  const parentNode = node.parent;
  return !(
    (ts.isPropertyAccessExpression(parentNode) || ts.isElementAccessExpression(parentNode)) &&
    parentNode.expression === node
  );
};

const collectComponentPropObservations = (
  component: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ComponentObservationAnalysis => {
  const propsParameter = component.parameters[0];
  if (!propsParameter || !component.body) {
    return { observations: [], complete: Boolean(component.body) };
  }
  const bindings = new Map<ts.Symbol, ComponentPropBinding>();
  let complete = bindComponentPattern(
    propsParameter.name,
    "",
    false,
    bindings,
    context.typeChecker,
  );
  const observationsByPath = new Map<string, ReactSemanticMemoPropObservation>();
  const addObservation = (node: ts.Expression, path: string): void => {
    const existingObservation = observationsByPath.get(path);
    const observation: ReactSemanticMemoPropObservation = {
      path,
      location: getNodeLocation(node, context.rootDirectory),
      valueCanVary: canTypeVary(context.typeChecker.getTypeAtLocation(node)),
    };
    if (!existingObservation || (!existingObservation.valueCanVary && observation.valueCanVary)) {
      observationsByPath.set(path, observation);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer && !ts.isIdentifier(node.name)) {
      const initializerBinding = getComponentPropBinding(
        node.initializer,
        bindings,
        context.typeChecker,
      );
      if (initializerBinding && !initializerBinding.isRest) {
        complete =
          bindComponentPattern(
            node.name,
            initializerBinding.path,
            false,
            bindings,
            context.typeChecker,
          ) && complete;
      }
    }
    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      isOutermostPropertyExpression(node)
    ) {
      let binding = getComponentPropBinding(node, bindings, context.typeChecker);
      const isMethodCall = ts.isCallExpression(node.parent) && node.parent.expression === node;
      if (isMethodCall) {
        const receiverBinding = getComponentPropBinding(
          node.expression,
          bindings,
          context.typeChecker,
        );
        if (receiverBinding?.path) {
          binding = receiverBinding;
        }
      }
      if (binding) {
        if (binding.isRest) {
          complete = false;
        } else {
          addObservation(node, binding.path);
        }
      } else if (
        ts.isElementAccessExpression(node) &&
        getComponentPropBinding(node.expression, bindings, context.typeChecker)
      ) {
        complete = false;
      }
    }
    if (ts.isIdentifier(node) && isIdentifierReference(node)) {
      const symbol = context.typeChecker.getSymbolAtLocation(node);
      const binding = symbol
        ? bindings.get(resolveAliasedSymbol(symbol, context.typeChecker))
        : null;
      const parentNode = node.parent;
      const isPropertyRoot =
        (ts.isPropertyAccessExpression(parentNode) || ts.isElementAccessExpression(parentNode)) &&
        parentNode.expression === node;
      if (binding && !isPropertyRoot) {
        if (binding.isRest || binding.path.length === 0) {
          complete = false;
          addObservation(node, "*");
        } else {
          addObservation(node, binding.path);
        }
      }
    }
    node.forEachChild(visit);
  };
  component.body.forEachChild(visit);
  return {
    observations: [...observationsByPath.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    complete,
  };
};

const deriveComparatorStatus = (
  ownerId: string | null,
  kind: ReactMemoComparatorKind,
  observationAnalysis: ComponentObservationAnalysis,
  comparatorAnalysis: ComparatorAnalysis,
): ReactMemoComparatorStatus => {
  if (!ownerId) return ReactMemoComparatorStatus.Unknown;
  if (kind === ReactMemoComparatorKind.DefaultShallow) {
    return ReactMemoComparatorStatus.Equivalent;
  }
  for (const truePath of comparatorAnalysis.truePaths) {
    if (!truePath.sourceComplete) continue;
    if (
      observationAnalysis.observations.some(
        (observation) =>
          observation.valueCanVary &&
          !isMemoObservationCovered(observation.path, truePath.equalPropPaths),
      )
    ) {
      return ReactMemoComparatorStatus.OmittedObservedProp;
    }
  }
  const hasUniversalTruePaths =
    comparatorAnalysis.truePaths.length > 0 &&
    comparatorAnalysis.truePaths.every(
      (truePath) => truePath.sourceComplete && truePath.equalPropPaths.includes(""),
    );
  return comparatorAnalysis.complete && (observationAnalysis.complete || hasUniversalTruePaths)
    ? ReactMemoComparatorStatus.Equivalent
    : ReactMemoComparatorStatus.Unknown;
};

const resolveMemoComponent = (
  expression: ts.Expression,
  context: ReactAnalysisContext,
): ts.FunctionLikeDeclaration | null => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (
    ts.isCallExpression(unwrappedExpression) &&
    getCanonicalReactApiName(unwrappedExpression.expression, context.typeChecker) === "forwardRef"
  ) {
    const renderExpression = unwrappedExpression.arguments[0];
    return renderExpression ? resolveFunction(renderExpression, context.typeChecker) : null;
  }
  return resolveFunction(unwrappedExpression, context.typeChecker);
};

export const collectMemoEquivalence = (
  descriptors: ReadonlyArray<ReactUnitDescriptor>,
  units: ReadonlyArray<ReactSemanticUnit>,
  sourceFiles: ReadonlyArray<ts.SourceFile>,
  context: ReactAnalysisContext,
): ReadonlyArray<ReactSemanticMemoComparator> => {
  const unitIdsByFunction = new Map<ts.FunctionLikeDeclaration, string>();
  descriptors.forEach((descriptor, descriptorIndex) => {
    const unitId = units[descriptorIndex]?.id;
    if (descriptor.functionNode && unitId) {
      unitIdsByFunction.set(descriptor.functionNode, unitId);
    }
  });
  const comparators: ReactSemanticMemoComparator[] = [];
  for (const sourceFile of sourceFiles) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        getCanonicalReactApiName(node.expression, context.typeChecker) === "memo"
      ) {
        const componentExpression = node.arguments[0];
        const component = componentExpression
          ? resolveMemoComponent(componentExpression, context)
          : null;
        const ownerId = component ? (unitIdsByFunction.get(component) ?? null) : null;
        const observationAnalysis = component
          ? collectComponentPropObservations(component, context)
          : { observations: [], complete: false };
        const comparatorExpression = node.arguments[1];
        const kind = comparatorExpression
          ? ReactMemoComparatorKind.Custom
          : ReactMemoComparatorKind.DefaultShallow;
        const resolvedComparator = comparatorExpression
          ? resolveFunction(comparatorExpression, context.typeChecker)
          : null;
        const comparatorAnalysis: ComparatorAnalysis =
          kind === ReactMemoComparatorKind.DefaultShallow
            ? {
                truePaths: [{ equalPropPaths: [""], sourceComplete: true }],
                complete: true,
              }
            : resolvedComparator
              ? analyzeComparator(resolvedComparator, context)
              : {
                  truePaths: [{ equalPropPaths: [], sourceComplete: false }],
                  complete: false,
                };
        const status = deriveComparatorStatus(
          ownerId,
          kind,
          observationAnalysis,
          comparatorAnalysis,
        );
        const hasUniversalTruePaths =
          comparatorAnalysis.truePaths.length > 0 &&
          comparatorAnalysis.truePaths.every(
            (truePath) => truePath.sourceComplete && truePath.equalPropPaths.includes(""),
          );
        const sourceComplete =
          ownerId !== null &&
          comparatorAnalysis.complete &&
          (kind === ReactMemoComparatorKind.DefaultShallow ||
            observationAnalysis.complete ||
            hasUniversalTruePaths);
        comparators.push({
          id: createSemanticId("memo-comparator", ownerId ?? "unresolved", node, context),
          ownerId,
          kind,
          location: getNodeLocation(node, context.rootDirectory),
          comparatorLocation: comparatorExpression
            ? getNodeLocation(comparatorExpression, context.rootDirectory)
            : null,
          observations: observationAnalysis.observations,
          truePaths: comparatorAnalysis.truePaths,
          observationComplete: observationAnalysis.complete,
          analysisComplete: comparatorAnalysis.complete,
          status,
          sourceComplete,
          complete: sourceComplete && status === ReactMemoComparatorStatus.Equivalent,
        });
      }
      node.forEachChild(visit);
    };
    sourceFile.forEachChild(visit);
  }
  return comparators;
};
