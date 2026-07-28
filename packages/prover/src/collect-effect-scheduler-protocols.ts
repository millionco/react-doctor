import ts from "typescript";
import { collectEffectCleanupFunctions } from "./collect-effect-cleanup-functions.js";
import { collectEffectCalls } from "./collect-effect-calls.js";
import { collectReachableFunctions } from "./collect-reachable-functions.js";
import { getEffectCallback } from "./get-effect-callback.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { ReactSchedulerCancellationStatus, ReactSchedulerKind } from "./types.js";
import type { ReactAnalysisContext } from "./types.js";
import { collectSymbolWrites } from "./utils/collect-symbol-writes.js";
import { collectReachableCallExpressions } from "./utils/collect-reachable-call-expressions.js";
import { getEnclosingFunction } from "./utils/get-enclosing-function.js";
import { hasGuaranteedEffectCleanup } from "./utils/has-guaranteed-effect-cleanup.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";

export interface EffectSchedulerProtocolDescriptor {
  callbackExpression: ts.Expression | null;
  cancellationCalls: ReadonlyArray<ts.CallExpression>;
  cancellationStatus: ReactSchedulerCancellationStatus;
  effectCall: ts.CallExpression;
  isSourceComplete: boolean;
  kind: ReactSchedulerKind;
  registrationCall: ts.CallExpression;
}

interface SchedulerApiDescriptor {
  cancellationName: string | null;
  kind: ReactSchedulerKind;
}

const SCHEDULER_APIS = new Map<string, SchedulerApiDescriptor>([
  [
    "queueMicrotask",
    {
      cancellationName: null,
      kind: ReactSchedulerKind.Microtask,
    },
  ],
  [
    "requestAnimationFrame",
    {
      cancellationName: "cancelAnimationFrame",
      kind: ReactSchedulerKind.AnimationFrame,
    },
  ],
  [
    "requestIdleCallback",
    {
      cancellationName: "cancelIdleCallback",
      kind: ReactSchedulerKind.IdleCallback,
    },
  ],
  [
    "setImmediate",
    {
      cancellationName: "clearImmediate",
      kind: ReactSchedulerKind.Immediate,
    },
  ],
  [
    "setInterval",
    {
      cancellationName: "clearInterval",
      kind: ReactSchedulerKind.Interval,
    },
  ],
  [
    "setTimeout",
    {
      cancellationName: "clearTimeout",
      kind: ReactSchedulerKind.Timeout,
    },
  ],
]);

const PLATFORM_GLOBAL_NAMES = new Set(["globalThis", "self", "window"]);

const getResolvedSymbol = (node: ts.Node, typeChecker: ts.TypeChecker): ts.Symbol | null => {
  const symbol = typeChecker.getSymbolAtLocation(node);
  if (!symbol) return null;
  return symbol.flags & ts.SymbolFlags.Alias ? typeChecker.getAliasedSymbol(symbol) : symbol;
};

const isPlatformDeclaration = (symbol: ts.Symbol | null): boolean =>
  Boolean(
    symbol?.declarations?.length &&
    symbol.declarations.every((declaration) => {
      const sourceFileName = declaration.getSourceFile().fileName.replaceAll("\\", "/");
      return (
        sourceFileName.includes("/typescript/lib/lib.") ||
        sourceFileName.includes("/node_modules/@types/node/")
      );
    }),
  );

const getPlatformExpressionName = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
): string | null => {
  const pendingExpressions = [expression];
  const visitedSymbols = new Set<ts.Symbol>();
  while (pendingExpressions.length > 0) {
    const pendingExpression = pendingExpressions.pop();
    if (!pendingExpression) continue;
    const unwrappedExpression = unwrapTypescriptExpression(pendingExpression);
    if (ts.isIdentifier(unwrappedExpression)) {
      const symbol = getResolvedSymbol(unwrappedExpression, typeChecker);
      if (isPlatformDeclaration(symbol)) return symbol?.getName() ?? null;
      if (!symbol || visitedSymbols.has(symbol)) continue;
      visitedSymbols.add(symbol);
      for (const declaration of symbol.declarations ?? []) {
        if (
          ts.isVariableDeclaration(declaration) &&
          ts.isVariableDeclarationList(declaration.parent) &&
          Boolean(declaration.parent.flags & ts.NodeFlags.Const) &&
          declaration.initializer &&
          collectSymbolWrites(symbol, declaration.getSourceFile(), typeChecker).length === 0
        ) {
          pendingExpressions.push(declaration.initializer);
        }
      }
      continue;
    }
    if (!ts.isPropertyAccessExpression(unwrappedExpression)) continue;
    const rootIdentifier = getRootIdentifier(unwrappedExpression.expression);
    if (
      rootIdentifier &&
      PLATFORM_GLOBAL_NAMES.has(rootIdentifier.text) &&
      isPlatformDeclaration(getResolvedSymbol(rootIdentifier, typeChecker))
    ) {
      return unwrappedExpression.name.text;
    }
  }
  return null;
};

const getPlatformCallName = (
  callExpression: ts.CallExpression,
  typeChecker: ts.TypeChecker,
): string | null => getPlatformExpressionName(callExpression.expression, typeChecker);

const getSchedulerApi = (
  callExpression: ts.CallExpression,
  typeChecker: ts.TypeChecker,
): SchedulerApiDescriptor | null => {
  const callName = getPlatformCallName(callExpression, typeChecker);
  return callName ? (SCHEDULER_APIS.get(callName) ?? null) : null;
};

export const getPlatformSchedulerKind = (
  callExpression: ts.CallExpression,
  context: ReactAnalysisContext,
): ReactSchedulerKind | null => getSchedulerApi(callExpression, context.typeChecker)?.kind ?? null;

const getImmutableHandle = (registrationCall: ts.CallExpression): ts.Identifier | null => {
  const declaration = ts.isVariableDeclaration(registrationCall.parent)
    ? registrationCall.parent
    : null;
  if (
    !declaration ||
    declaration.initializer !== registrationCall ||
    !ts.isIdentifier(declaration.name) ||
    !ts.isVariableDeclarationList(declaration.parent) ||
    !(declaration.parent.flags & ts.NodeFlags.Const)
  ) {
    return null;
  }
  return declaration.name;
};

const hasConditionalAncestor = (
  node: ts.Node,
  ownerFunction: ts.FunctionLikeDeclaration,
): boolean => {
  let currentNode = node;
  while (currentNode !== ownerFunction) {
    const parentNode = currentNode.parent;
    if (!parentNode) return true;
    if (
      ts.isIfStatement(parentNode) ||
      ts.isConditionalExpression(parentNode) ||
      ts.isSwitchStatement(parentNode) ||
      ts.isForStatement(parentNode) ||
      ts.isForInStatement(parentNode) ||
      ts.isForOfStatement(parentNode) ||
      ts.isWhileStatement(parentNode) ||
      ts.isDoStatement(parentNode) ||
      ts.isTryStatement(parentNode) ||
      (ts.isBinaryExpression(parentNode) &&
        (parentNode.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          parentNode.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          parentNode.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken))
    ) {
      return true;
    }
    currentNode = parentNode;
  }
  return false;
};

const isEntryCancellation = (
  callExpression: ts.CallExpression,
  cleanupFunction: ts.FunctionLikeDeclaration,
): boolean => {
  if (
    getEnclosingFunction(callExpression) !== cleanupFunction ||
    hasConditionalAncestor(callExpression, cleanupFunction)
  ) {
    return false;
  }
  const functionBody = cleanupFunction.body;
  if (!functionBody) return false;
  if (!ts.isBlock(functionBody)) return functionBody === callExpression;
  const firstStatement = functionBody.statements[0];
  return Boolean(
    firstStatement &&
    ((ts.isExpressionStatement(firstStatement) && firstStatement.expression === callExpression) ||
      (ts.isReturnStatement(firstStatement) && firstStatement.expression === callExpression)),
  );
};

const isMatchingCancellation = (
  callExpression: ts.CallExpression,
  cancellationName: string,
  handleSymbol: ts.Symbol,
  typeChecker: ts.TypeChecker,
): boolean => {
  if (getPlatformCallName(callExpression, typeChecker) !== cancellationName) {
    return false;
  }
  const handleArgument = callExpression.arguments[0];
  return Boolean(
    handleArgument &&
    ts.isIdentifier(handleArgument) &&
    typeChecker.getSymbolAtLocation(handleArgument) === handleSymbol,
  );
};

const collectCancellation = (
  effectCallback: ts.FunctionLikeDeclaration,
  registrationCall: ts.CallExpression,
  cancellationName: string | null,
  typeChecker: ts.TypeChecker,
): {
  calls: ReadonlyArray<ts.CallExpression>;
  status: ReactSchedulerCancellationStatus;
} => {
  if (!cancellationName) {
    return { calls: [], status: ReactSchedulerCancellationStatus.Unknown };
  }
  const handle = getImmutableHandle(registrationCall);
  const handleSymbol = handle ? typeChecker.getSymbolAtLocation(handle) : null;
  if (!handleSymbol) {
    const immediateCancellation =
      ts.isCallExpression(registrationCall.parent) &&
      registrationCall.parent.arguments[0] === registrationCall &&
      getPlatformCallName(registrationCall.parent, typeChecker) === cancellationName
        ? registrationCall.parent
        : null;
    if (immediateCancellation) {
      return {
        calls: [immediateCancellation],
        status: ReactSchedulerCancellationStatus.Unknown,
      };
    }
    const hasAssignedHandle =
      (ts.isVariableDeclaration(registrationCall.parent) &&
        registrationCall.parent.initializer === registrationCall) ||
      (ts.isBinaryExpression(registrationCall.parent) &&
        registrationCall.parent.right === registrationCall &&
        registrationCall.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken);
    return {
      calls: [],
      status: hasAssignedHandle
        ? ReactSchedulerCancellationStatus.Unknown
        : ReactSchedulerCancellationStatus.Missing,
    };
  }
  const cleanupFunctions = collectEffectCleanupFunctions(effectCallback, typeChecker);
  if (cleanupFunctions.length === 0 || !hasGuaranteedEffectCleanup(effectCallback, typeChecker)) {
    return { calls: [], status: ReactSchedulerCancellationStatus.Missing };
  }
  const matchingCalls: ts.CallExpression[] = [];
  for (const cleanupFunction of cleanupFunctions) {
    const cleanupCalls = collectReachableCallExpressions(cleanupFunction, typeChecker);
    const cleanupMatchingCalls = cleanupCalls.filter((cleanupCall) =>
      isMatchingCancellation(cleanupCall, cancellationName, handleSymbol, typeChecker),
    );
    if (cleanupMatchingCalls.length === 0) {
      return {
        calls: matchingCalls,
        status:
          cleanupCalls.length === 0
            ? ReactSchedulerCancellationStatus.Missing
            : ReactSchedulerCancellationStatus.Unknown,
      };
    }
    const entryCancellation = cleanupMatchingCalls.find((cleanupCall) =>
      isEntryCancellation(cleanupCall, cleanupFunction),
    );
    if (!entryCancellation) {
      return {
        calls: [...matchingCalls, ...cleanupMatchingCalls],
        status: ReactSchedulerCancellationStatus.Unknown,
      };
    }
    matchingCalls.push(entryCancellation);
  }
  return {
    calls: matchingCalls,
    status: ReactSchedulerCancellationStatus.Guaranteed,
  };
};

export const collectEffectSchedulerProtocols = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReadonlyArray<EffectSchedulerProtocolDescriptor> => {
  const protocols: EffectSchedulerProtocolDescriptor[] = [];
  for (const effectCall of collectEffectCalls(functionNode, context.typeChecker)) {
    const effectCallback = getEffectCallback(effectCall, context.typeChecker);
    if (!effectCallback) continue;
    const reachableFunctions = collectReachableFunctions(effectCallback, context.typeChecker);
    for (const registrationCall of collectReachableCallExpressions(
      effectCallback,
      context.typeChecker,
    )) {
      const schedulerApi = getSchedulerApi(registrationCall, context.typeChecker);
      if (!schedulerApi) continue;
      const registrationOwner = getEnclosingFunction(registrationCall);
      const reachableRegistration = registrationOwner
        ? reachableFunctions.find(
            (reachableFunction) => reachableFunction.functionNode === registrationOwner,
          )
        : null;
      const cancellation = collectCancellation(
        effectCallback,
        registrationCall,
        schedulerApi.cancellationName,
        context.typeChecker,
      );
      const isRegistrationConditional = Boolean(
        !registrationOwner ||
        reachableRegistration?.isConditionallyReached ||
        hasConditionalAncestor(registrationCall, registrationOwner),
      );
      const callbackExpression = registrationCall.arguments[0] ?? null;
      protocols.push({
        callbackExpression,
        cancellationCalls: cancellation.calls,
        cancellationStatus: cancellation.status,
        effectCall,
        isSourceComplete:
          Boolean(callbackExpression) &&
          !isRegistrationConditional &&
          cancellation.status === ReactSchedulerCancellationStatus.Guaranteed,
        kind: schedulerApi.kind,
        registrationCall,
      });
    }
  }
  return protocols;
};
