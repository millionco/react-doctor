import ts from "typescript";
import { collectEffectCleanupFunctions } from "./collect-effect-cleanup-functions.js";
import { collectEffectCalls } from "./collect-effect-calls.js";
import { collectHookBindings } from "./collect-hook-bindings.js";
import { PROMISE_CONTINUATION_METHOD_NAMES } from "./constants.js";
import { getEffectCallback } from "./get-effect-callback.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { resolveFunction } from "./resolve-function.js";
import { ReactAsyncOwnershipStatus } from "./types.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";
import { containsAwaitOutsideNestedFunction } from "./utils/contains-await-outside-nested-function.js";
import { hasGuaranteedEffectCleanup } from "./utils/has-guaranteed-effect-cleanup.js";
import { isAssignmentOperator } from "./utils/is-assignment-operator.js";
import type { ReactAnalysisContext, ReactAsyncEffectTaskDescriptor } from "./types.js";

interface AsyncStateWrite {
  callExpression: ts.CallExpression;
  hasOpaqueGuard: boolean;
  isGuarded: boolean;
  stateWriteName: string;
}

interface AsyncTaskOperations {
  stateWrites: ReadonlyArray<AsyncStateWrite>;
  unknownOperation: ts.Node | null;
}

interface EffectInvalidationGuards {
  abortedControllerSymbols: ReadonlySet<ts.Symbol>;
  invalidatedBooleanSymbols: ReadonlySet<ts.Symbol>;
}

const getDirectStatement = (node: ts.Node, block: ts.Block): ts.Statement | null => {
  let currentNode = node;
  while (currentNode.parent !== block) {
    if (!currentNode.parent || isFunctionBoundary(currentNode.parent)) return null;
    currentNode = currentNode.parent;
  }
  return ts.isStatement(currentNode) ? currentNode : null;
};

const hasSequentialAwaitBefore = (
  operationNode: ts.Node,
  taskFunction: ts.FunctionLikeDeclaration,
): boolean => {
  if (!taskFunction.body || !ts.isBlock(taskFunction.body)) return false;
  if (containsAwaitOutsideNestedFunction(operationNode, taskFunction)) return true;
  const containingStatement = getDirectStatement(operationNode, taskFunction.body);
  if (!containingStatement) return false;
  const statementIndex = taskFunction.body.statements.indexOf(containingStatement);
  return taskFunction.body.statements
    .slice(0, statementIndex)
    .some((statement) => containsAwaitOutsideNestedFunction(statement, taskFunction));
};

const getIdentifierSymbol = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
): ts.Symbol | null => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (!ts.isIdentifier(unwrappedExpression)) return null;
  return typeChecker.getSymbolAtLocation(unwrappedExpression) ?? null;
};

const getAbortedControllerSymbol = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
): ts.Symbol | null => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (
    !ts.isPropertyAccessExpression(unwrappedExpression) ||
    unwrappedExpression.name.text !== "aborted" ||
    !ts.isPropertyAccessExpression(unwrappedExpression.expression) ||
    unwrappedExpression.expression.name.text !== "signal"
  ) {
    return null;
  }
  return getIdentifierSymbol(unwrappedExpression.expression.expression, typeChecker);
};

const isInvalidatedCondition = (
  expression: ts.Expression,
  guards: EffectInvalidationGuards,
  typeChecker: ts.TypeChecker,
): boolean => {
  const booleanSymbol = getIdentifierSymbol(expression, typeChecker);
  if (booleanSymbol && guards.invalidatedBooleanSymbols.has(booleanSymbol)) return true;
  const controllerSymbol = getAbortedControllerSymbol(expression, typeChecker);
  return Boolean(controllerSymbol && guards.abortedControllerSymbols.has(controllerSymbol));
};

const isValidCondition = (
  expression: ts.Expression,
  guards: EffectInvalidationGuards,
  typeChecker: ts.TypeChecker,
): boolean => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  return (
    ts.isPrefixUnaryExpression(unwrappedExpression) &&
    unwrappedExpression.operator === ts.SyntaxKind.ExclamationToken &&
    isInvalidatedCondition(unwrappedExpression.operand, guards, typeChecker)
  );
};

const containsReturn = (statement: ts.Statement): boolean => {
  let didFindReturn = false;
  const visit = (node: ts.Node): void => {
    if (didFindReturn || isFunctionBoundary(node)) return;
    if (ts.isReturnStatement(node)) {
      didFindReturn = true;
      return;
    }
    node.forEachChild(visit);
  };
  statement.forEachChild(visit);
  return didFindReturn;
};

const hasGuardingAncestor = (
  callExpression: ts.CallExpression,
  taskFunction: ts.FunctionLikeDeclaration,
  guards: EffectInvalidationGuards,
  typeChecker: ts.TypeChecker,
): { hasOpaqueGuard: boolean; isGuarded: boolean } => {
  let hasOpaqueGuard = false;
  let currentNode: ts.Node = callExpression;
  while (currentNode !== taskFunction) {
    const parentNode = currentNode.parent;
    if (!parentNode) break;
    if (ts.isIfStatement(parentNode)) {
      const isThenBranch =
        currentNode === parentNode.thenStatement ||
        (currentNode.getStart() >= parentNode.thenStatement.getStart() &&
          currentNode.getEnd() <= parentNode.thenStatement.getEnd());
      if (isThenBranch && isValidCondition(parentNode.expression, guards, typeChecker)) {
        return { hasOpaqueGuard, isGuarded: true };
      }
      hasOpaqueGuard = true;
    }
    if (
      ts.isBinaryExpression(parentNode) &&
      parentNode.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      parentNode.right.getStart() <= currentNode.getStart() &&
      isValidCondition(parentNode.left, guards, typeChecker)
    ) {
      return { hasOpaqueGuard, isGuarded: true };
    }
    currentNode = parentNode;
  }
  return { hasOpaqueGuard, isGuarded: false };
};

const hasGuardingEarlyReturn = (
  callExpression: ts.CallExpression,
  guards: EffectInvalidationGuards,
  typeChecker: ts.TypeChecker,
): boolean => {
  let currentNode: ts.Node = callExpression;
  while (currentNode.parent) {
    const parentNode = currentNode.parent;
    if (ts.isBlock(parentNode)) {
      const containingStatement = getDirectStatement(callExpression, parentNode);
      if (containingStatement) {
        const statementIndex = parentNode.statements.indexOf(containingStatement);
        if (
          parentNode.statements
            .slice(0, statementIndex)
            .some(
              (statement) =>
                ts.isIfStatement(statement) &&
                isInvalidatedCondition(statement.expression, guards, typeChecker) &&
                containsReturn(statement.thenStatement),
            )
        ) {
          return true;
        }
      }
    }
    if (isFunctionBoundary(parentNode)) break;
    currentNode = parentNode;
  }
  return false;
};

const intersectSymbols = (
  symbolSets: ReadonlyArray<ReadonlySet<ts.Symbol>>,
): ReadonlySet<ts.Symbol> => {
  const [firstSymbolSet, ...remainingSymbolSets] = symbolSets;
  if (!firstSymbolSet) return new Set();
  return new Set(
    [...firstSymbolSet].filter((symbol) =>
      remainingSymbolSets.every((symbolSet) => symbolSet.has(symbol)),
    ),
  );
};

const collectGuaranteedCleanupGuards = (
  cleanupFunction: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): EffectInvalidationGuards => {
  const invalidatedBooleanSymbols = new Set<ts.Symbol>();
  const abortedControllerSymbols = new Set<ts.Symbol>();
  const expressions: ts.Expression[] = [];
  if (cleanupFunction.body && ts.isBlock(cleanupFunction.body)) {
    for (const statement of cleanupFunction.body.statements) {
      if (ts.isEmptyStatement(statement)) continue;
      if (!ts.isExpressionStatement(statement)) break;
      expressions.push(statement.expression);
    }
  } else if (cleanupFunction.body) {
    expressions.push(cleanupFunction.body);
  }
  for (const expression of expressions) {
    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      expression.right.kind === ts.SyntaxKind.TrueKeyword
    ) {
      const symbol = getIdentifierSymbol(expression.left, typeChecker);
      if (!symbol) break;
      invalidatedBooleanSymbols.add(symbol);
      continue;
    }
    if (
      ts.isCallExpression(expression) &&
      ts.isPropertyAccessExpression(expression.expression) &&
      expression.expression.name.text === "abort"
    ) {
      const symbol = getIdentifierSymbol(expression.expression.expression, typeChecker);
      if (!symbol) break;
      abortedControllerSymbols.add(symbol);
      continue;
    }
    break;
  }
  return { abortedControllerSymbols, invalidatedBooleanSymbols };
};

const collectInvalidationGuards = (
  effectCallback: ts.FunctionLikeDeclaration,
  cleanupFunctions: ReadonlyArray<ts.FunctionLikeDeclaration>,
  typeChecker: ts.TypeChecker,
): EffectInvalidationGuards => {
  if (!hasGuaranteedEffectCleanup(effectCallback, typeChecker)) {
    return {
      abortedControllerSymbols: new Set(),
      invalidatedBooleanSymbols: new Set(),
    };
  }
  const invalidatedBooleanSymbolSets: Set<ts.Symbol>[] = [];
  const abortedControllerSymbolSets: Set<ts.Symbol>[] = [];
  for (const cleanupFunction of cleanupFunctions) {
    const cleanupGuards = collectGuaranteedCleanupGuards(cleanupFunction, typeChecker);
    invalidatedBooleanSymbolSets.push(new Set(cleanupGuards.invalidatedBooleanSymbols));
    abortedControllerSymbolSets.push(new Set(cleanupGuards.abortedControllerSymbols));
  }
  return {
    abortedControllerSymbols: intersectSymbols(abortedControllerSymbolSets),
    invalidatedBooleanSymbols: intersectSymbols(invalidatedBooleanSymbolSets),
  };
};

const collectInvokedAsyncFunctions = (
  effectCallback: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<ts.FunctionLikeDeclaration> => {
  const taskFunctions = new Set<ts.FunctionLikeDeclaration>();
  const visit = (node: ts.Node): void => {
    if (node !== effectCallback && isFunctionBoundary(node)) return;
    if (ts.isCallExpression(node)) {
      const taskFunction = resolveFunction(node.expression, typeChecker);
      if (taskFunction && containsAwaitOutsideNestedFunction(taskFunction, taskFunction)) {
        taskFunctions.add(taskFunction);
      }
    }
    node.forEachChild(visit);
  };
  effectCallback.forEachChild(visit);
  return [...taskFunctions];
};

const collectAsyncTaskOperations = (
  taskFunction: ts.FunctionLikeDeclaration,
  stateSetters: ReadonlySet<ts.Symbol>,
  guards: EffectInvalidationGuards,
  typeChecker: ts.TypeChecker,
  startsAfterSuspension: boolean,
): AsyncTaskOperations => {
  const stateWrites: AsyncStateWrite[] = [];
  let unknownOperation: ts.Node | null = null;
  const visit = (node: ts.Node): void => {
    if (node !== taskFunction && isFunctionBoundary(node)) return;
    if (ts.isCallExpression(node)) {
      const setterSymbol = getIdentifierSymbol(node.expression, typeChecker);
      const isAfterSuspension =
        startsAfterSuspension || hasSequentialAwaitBefore(node, taskFunction);
      if (setterSymbol && stateSetters.has(setterSymbol) && isAfterSuspension) {
        const ancestorGuard = hasGuardingAncestor(node, taskFunction, guards, typeChecker);
        stateWrites.push({
          callExpression: node,
          hasOpaqueGuard: ancestorGuard.hasOpaqueGuard,
          isGuarded: ancestorGuard.isGuarded || hasGuardingEarlyReturn(node, guards, typeChecker),
          stateWriteName: node.expression.getText(),
        });
      } else if (
        isAfterSuspension &&
        !(
          ts.isPropertyAccessExpression(node.expression) &&
          PROMISE_CONTINUATION_METHOD_NAMES.has(node.expression.name.text)
        )
      ) {
        unknownOperation ??= node;
      }
    }
    if (
      !unknownOperation &&
      ts.isBinaryExpression(node) &&
      isAssignmentOperator(node.operatorToken.kind) &&
      (startsAfterSuspension || hasSequentialAwaitBefore(node, taskFunction))
    ) {
      unknownOperation = node;
    }
    if (
      !unknownOperation &&
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      (startsAfterSuspension || hasSequentialAwaitBefore(node, taskFunction))
    ) {
      unknownOperation = node;
    }
    node.forEachChild(visit);
  };
  taskFunction.forEachChild(visit);
  return { stateWrites, unknownOperation };
};

const createTaskDescriptor = (
  effectCall: ts.CallExpression,
  taskNode: ts.Node,
  operations: AsyncTaskOperations,
): ReactAsyncEffectTaskDescriptor | null => {
  const unguardedWrite = operations.stateWrites.find(
    (stateWrite) => !stateWrite.isGuarded && !stateWrite.hasOpaqueGuard,
  );
  const unknownWrite = operations.stateWrites.find(
    (stateWrite) => !stateWrite.isGuarded && stateWrite.hasOpaqueGuard,
  );
  const unknownNode = unknownWrite?.callExpression ?? operations.unknownOperation;
  if (!unguardedWrite && !unknownNode && operations.stateWrites.length === 0) return null;
  return {
    effectCall,
    evidenceDescription: unguardedWrite
      ? "A state write after an async suspension can commit after its Effect was superseded"
      : unknownWrite
        ? "A state write after an async suspension has an unmodeled ownership guard"
        : "An operation after an async suspension has no checked React ownership summary",
    evidenceNode:
      unguardedWrite?.callExpression ??
      unknownNode ??
      operations.stateWrites[0]?.callExpression ??
      taskNode,
    stateWriteNames: operations.stateWrites.map((stateWrite) => stateWrite.stateWriteName),
    status: unguardedWrite
      ? ReactAsyncOwnershipStatus.Unguarded
      : unknownNode
        ? ReactAsyncOwnershipStatus.Unknown
        : ReactAsyncOwnershipStatus.Guarded,
    taskNode,
  };
};

const isPromiseContinuationCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  PROMISE_CONTINUATION_METHOD_NAMES.has(node.expression.name.text);

const collectPromiseContinuationDescriptors = (
  ownerFunction: ts.FunctionLikeDeclaration,
  effectCall: ts.CallExpression,
  guards: EffectInvalidationGuards,
  stateSetters: ReadonlySet<ts.Symbol>,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<ReactAsyncEffectTaskDescriptor> => {
  const descriptors: ReactAsyncEffectTaskDescriptor[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== ownerFunction && isFunctionBoundary(node)) return;
    if (isPromiseContinuationCall(node)) {
      const stateWrites: AsyncStateWrite[] = [];
      let unknownOperation: ts.Node | null = null;
      for (const callbackExpression of node.arguments) {
        const setterSymbol = getIdentifierSymbol(callbackExpression, typeChecker);
        if (setterSymbol && stateSetters.has(setterSymbol)) {
          stateWrites.push({
            callExpression: node,
            hasOpaqueGuard: false,
            isGuarded: false,
            stateWriteName: callbackExpression.getText(),
          });
          continue;
        }
        const callbackFunction = resolveFunction(callbackExpression, typeChecker);
        if (!callbackFunction) {
          unknownOperation ??= callbackExpression;
          continue;
        }
        const callbackOperations = collectAsyncTaskOperations(
          callbackFunction,
          stateSetters,
          guards,
          typeChecker,
          true,
        );
        stateWrites.push(...callbackOperations.stateWrites);
        unknownOperation ??= callbackOperations.unknownOperation;
      }
      const descriptor = createTaskDescriptor(effectCall, node, {
        stateWrites,
        unknownOperation,
      });
      if (descriptor) descriptors.push(descriptor);
    }
    node.forEachChild(visit);
  };
  ownerFunction.forEachChild(visit);
  return descriptors;
};

export const collectAsyncEffectTaskDescriptors = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReadonlyArray<ReactAsyncEffectTaskDescriptor> => {
  const hookBindings = collectHookBindings(functionNode, context.typeChecker);
  const tasks: ReactAsyncEffectTaskDescriptor[] = [];

  for (const effectCall of collectEffectCalls(functionNode, context.typeChecker)) {
    const effectCallback = getEffectCallback(effectCall, context.typeChecker);
    if (!effectCallback) continue;
    const cleanupFunctions = collectEffectCleanupFunctions(effectCallback, context.typeChecker);
    const guards = collectInvalidationGuards(effectCallback, cleanupFunctions, context.typeChecker);
    const taskFunctions = collectInvokedAsyncFunctions(effectCallback, context.typeChecker);
    tasks.push(
      ...collectPromiseContinuationDescriptors(
        effectCallback,
        effectCall,
        guards,
        hookBindings.stateSetters,
        context.typeChecker,
      ),
    );
    for (const taskFunction of taskFunctions) {
      const operations = collectAsyncTaskOperations(
        taskFunction,
        hookBindings.stateSetters,
        guards,
        context.typeChecker,
        false,
      );
      const descriptor = createTaskDescriptor(effectCall, taskFunction, operations);
      if (descriptor) tasks.push(descriptor);
      tasks.push(
        ...collectPromiseContinuationDescriptors(
          taskFunction,
          effectCall,
          guards,
          hookBindings.stateSetters,
          context.typeChecker,
        ),
      );
    }
  }
  return tasks;
};
