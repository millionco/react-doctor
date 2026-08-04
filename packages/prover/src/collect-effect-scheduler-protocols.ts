import ts from "typescript";
import { collectEffectCleanupFunctions } from "./collect-effect-cleanup-functions.js";
import { collectEffectCalls } from "./collect-effect-calls.js";
import { collectReachableFunctions } from "./collect-reachable-functions.js";
import { getEffectCallback } from "./get-effect-callback.js";
import { ReactSchedulerCancellationStatus, ReactSchedulerKind } from "./types.js";
import type { ReactAnalysisContext } from "./types.js";
import { collectPropertySymbolWrites } from "./utils/collect-property-symbol-writes.js";
import { collectSymbolWrites } from "./utils/collect-symbol-writes.js";
import { collectReachableCallExpressions } from "./utils/collect-reachable-call-expressions.js";
import { getEnclosingFunction } from "./utils/get-enclosing-function.js";
import { getResolvedSymbol } from "./utils/get-resolved-symbol.js";
import { hasConditionalAncestor } from "./utils/has-conditional-ancestor.js";
import { hasGuaranteedEffectCleanup } from "./utils/has-guaranteed-effect-cleanup.js";
import { isEntryDominatingNode } from "./utils/is-entry-dominating-node.js";
import { isPlatformDeclarationSymbol } from "./utils/is-platform-declaration-symbol.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";

export interface LifecycleSchedulerProtocolDescriptor {
  callbackExpression: ts.Expression | null;
  cancellationCalls: ReadonlyArray<ts.CallExpression>;
  cancellationStatus: ReactSchedulerCancellationStatus;
  handleDeclaration: ts.PropertyDeclaration | null;
  isSourceComplete: boolean;
  kind: ReactSchedulerKind;
  registrationCall: ts.CallExpression;
}

export interface EffectSchedulerProtocolDescriptor extends LifecycleSchedulerProtocolDescriptor {
  effectCall: ts.CallExpression;
}

interface SchedulerApiDescriptor {
  cancellationName: string | null;
  kind: ReactSchedulerKind;
}

interface SchedulerHandleDescriptor {
  expression: ts.Expression;
  symbol: ts.Symbol;
  propertyDeclaration: ts.PropertyDeclaration | null;
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
      if (isPlatformDeclarationSymbol(symbol)) return symbol?.getName() ?? null;
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
    if (
      ts.isPropertyAccessExpression(unwrappedExpression) &&
      isPlatformDeclarationSymbol(getResolvedSymbol(unwrappedExpression.name, typeChecker))
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

const getImmutableHandle = (
  registrationCall: ts.CallExpression,
  typeChecker: ts.TypeChecker,
): SchedulerHandleDescriptor | null => {
  const declaration = ts.isVariableDeclaration(registrationCall.parent)
    ? registrationCall.parent
    : null;
  if (
    declaration &&
    declaration.initializer === registrationCall &&
    ts.isIdentifier(declaration.name) &&
    ts.isVariableDeclarationList(declaration.parent) &&
    Boolean(declaration.parent.flags & ts.NodeFlags.Const)
  ) {
    const symbol = getResolvedSymbol(declaration.name, typeChecker);
    return symbol
      ? {
          expression: declaration.name,
          symbol,
          propertyDeclaration: null,
        }
      : null;
  }
  const assignment = ts.isBinaryExpression(registrationCall.parent)
    ? registrationCall.parent
    : null;
  if (
    !assignment ||
    assignment.right !== registrationCall ||
    assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
    !ts.isPropertyAccessExpression(assignment.left) ||
    assignment.left.expression.kind !== ts.SyntaxKind.ThisKeyword
  ) {
    return null;
  }
  const symbol = getResolvedSymbol(assignment.left.name, typeChecker);
  const propertyDeclaration = symbol?.declarations?.find(ts.isPropertyDeclaration) ?? null;
  const initializer = propertyDeclaration?.initializer;
  const propertyWrites = symbol
    ? collectPropertySymbolWrites(symbol, registrationCall.getSourceFile(), typeChecker)
    : [];
  const hasSafeInitializer = Boolean(
    propertyDeclaration &&
    (!initializer ||
      ts.isNumericLiteral(initializer) ||
      initializer.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isIdentifier(initializer) && initializer.text === "undefined")),
  );
  if (
    !symbol ||
    !propertyDeclaration ||
    !hasSafeInitializer ||
    propertyWrites.length !== 1 ||
    propertyWrites[0] !== assignment
  ) {
    return null;
  }
  return {
    expression: assignment.left,
    symbol,
    propertyDeclaration,
  };
};

const isMatchingCancellation = (
  callExpression: ts.CallExpression,
  cancellationName: string,
  handle: SchedulerHandleDescriptor,
  typeChecker: ts.TypeChecker,
): boolean => {
  if (getPlatformCallName(callExpression, typeChecker) !== cancellationName) {
    return false;
  }
  const handleArgument = callExpression.arguments[0];
  if (!handleArgument) return false;
  if (ts.isIdentifier(handle.expression) && ts.isIdentifier(handleArgument)) {
    return getResolvedSymbol(handleArgument, typeChecker) === handle.symbol;
  }
  return Boolean(
    ts.isPropertyAccessExpression(handle.expression) &&
    ts.isPropertyAccessExpression(handleArgument) &&
    handle.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
    handleArgument.expression.kind === ts.SyntaxKind.ThisKeyword &&
    getResolvedSymbol(handleArgument.name, typeChecker) === handle.symbol,
  );
};

const collectCancellation = (
  cleanupFunctions: ReadonlyArray<ts.FunctionLikeDeclaration>,
  hasGuaranteedCleanup: boolean,
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
  const handle = getImmutableHandle(registrationCall, typeChecker);
  if (!handle) {
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
  if (cleanupFunctions.length === 0 || !hasGuaranteedCleanup) {
    return { calls: [], status: ReactSchedulerCancellationStatus.Missing };
  }
  const matchingCalls: ts.CallExpression[] = [];
  for (const cleanupFunction of cleanupFunctions) {
    const cleanupCalls = collectReachableCallExpressions(cleanupFunction, typeChecker);
    const cleanupMatchingCalls = cleanupCalls.filter((cleanupCall) =>
      isMatchingCancellation(cleanupCall, cancellationName, handle, typeChecker),
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
      isEntryDominatingNode(cleanupCall, cleanupFunction),
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

export const collectLifecycleSchedulerProtocols = (
  setupFunction: ts.FunctionLikeDeclaration,
  cleanupFunctions: ReadonlyArray<ts.FunctionLikeDeclaration>,
  hasGuaranteedCleanup: boolean,
  context: ReactAnalysisContext,
): ReadonlyArray<LifecycleSchedulerProtocolDescriptor> => {
  const protocols: LifecycleSchedulerProtocolDescriptor[] = [];
  const reachableFunctions = collectReachableFunctions(setupFunction, context.typeChecker);
  for (const registrationCall of collectReachableCallExpressions(
    setupFunction,
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
      cleanupFunctions,
      hasGuaranteedCleanup,
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
      handleDeclaration:
        getImmutableHandle(registrationCall, context.typeChecker)?.propertyDeclaration ?? null,
      isSourceComplete:
        Boolean(callbackExpression) &&
        !isRegistrationConditional &&
        cancellation.status === ReactSchedulerCancellationStatus.Guaranteed,
      kind: schedulerApi.kind,
      registrationCall,
    });
  }
  return protocols;
};

export const collectEffectSchedulerProtocols = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReadonlyArray<EffectSchedulerProtocolDescriptor> => {
  const protocols: EffectSchedulerProtocolDescriptor[] = [];
  for (const effectCall of collectEffectCalls(functionNode, context.typeChecker)) {
    const effectCallback = getEffectCallback(effectCall, context.typeChecker);
    if (!effectCallback) continue;
    const cleanupFunctions = collectEffectCleanupFunctions(effectCallback, context.typeChecker);
    protocols.push(
      ...collectLifecycleSchedulerProtocols(
        effectCallback,
        cleanupFunctions,
        hasGuaranteedEffectCleanup(effectCallback, context.typeChecker),
        context,
      ).map((protocol) => ({ ...protocol, effectCall })),
    );
  }
  return protocols;
};
