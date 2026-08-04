import ts from "typescript";
import { collectEffectCleanupFunctions } from "./collect-effect-cleanup-functions.js";
import { collectEffectCalls } from "./collect-effect-calls.js";
import {
  collectReachableFunctionGraph,
  collectReachableFunctions,
} from "./collect-reachable-functions.js";
import { PLATFORM_OBSERVER_KINDS } from "./constants.js";
import { getEffectCallback } from "./get-effect-callback.js";
import { ReactEffectResourceDisposalStatus, ReactEffectResourceKind } from "./types.js";
import type { ReactAnalysisContext } from "./types.js";
import { areImmutableExpressionsIdentical } from "./utils/are-immutable-expressions-identical.js";
import { collectReachableCallExpressions } from "./utils/collect-reachable-call-expressions.js";
import { getEnclosingFunction } from "./utils/get-enclosing-function.js";
import { getPlatformEffectResourceKind } from "./utils/get-platform-effect-resource-kind.js";
import { getResolvedSymbol } from "./utils/get-resolved-symbol.js";
import { getStaticPropertyName } from "./utils/get-static-property-name.js";
import { hasConditionalAncestor } from "./utils/has-conditional-ancestor.js";
import { hasGuaranteedEffectCleanup } from "./utils/has-guaranteed-effect-cleanup.js";
import { isEntryDominatingNode } from "./utils/is-entry-dominating-node.js";
import { isPlatformDeclarationSymbol } from "./utils/is-platform-declaration-symbol.js";
import { isPlatformResourceValue } from "./utils/is-platform-resource-value.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";

export interface LifecycleResourceProtocolDescriptor {
  acquisitionNode: ts.Node;
  acquisitionNodes: ReadonlyArray<ts.Node>;
  callbackExpression: ts.Expression | null;
  disposalCalls: ReadonlyArray<ts.CallExpression>;
  disposalStatus: ReactEffectResourceDisposalStatus;
  isSourceComplete: boolean;
  kind: ReactEffectResourceKind;
}

export interface EffectResourceProtocolDescriptor extends LifecycleResourceProtocolDescriptor {
  effectCall: ts.CallExpression;
}

interface EventListenerDescriptor {
  eventExpression: ts.Expression;
  handlerExpression: ts.Expression;
  capture: boolean | null;
  signalControllerExpression: ts.Expression | null;
  targetExpression: ts.Expression;
}

interface ObserverDescriptor {
  activationCalls: ts.CallExpression[];
  callbackExpression: ts.Expression | null;
  kind: ReactEffectResourceKind;
  resourceExpression: ts.Expression;
}

interface EffectResourceDisposal {
  calls: ReadonlyArray<ts.CallExpression>;
  status: ReactEffectResourceDisposalStatus;
}

const isPlatformMember = (
  node: ts.Node,
  expectedName: string,
  typeChecker: ts.TypeChecker,
): boolean => {
  const symbol = getResolvedSymbol(node, typeChecker);
  return Boolean(
    symbol && symbol.getName() === expectedName && isPlatformDeclarationSymbol(symbol),
  );
};

const getStaticBoolean = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
  visitedSymbols: ReadonlySet<ts.Symbol> = new Set(),
): boolean | null => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (unwrappedExpression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (
    unwrappedExpression.kind === ts.SyntaxKind.FalseKeyword ||
    unwrappedExpression.kind === ts.SyntaxKind.NullKeyword
  ) {
    return false;
  }
  if (!ts.isIdentifier(unwrappedExpression)) return null;
  if (unwrappedExpression.text === "undefined") return false;
  const symbol = getResolvedSymbol(unwrappedExpression, typeChecker);
  if (!symbol || visitedSymbols.has(symbol)) return null;
  for (const declaration of symbol.declarations ?? []) {
    if (
      ts.isVariableDeclaration(declaration) &&
      ts.isVariableDeclarationList(declaration.parent) &&
      Boolean(declaration.parent.flags & ts.NodeFlags.Const) &&
      declaration.initializer
    ) {
      return getStaticBoolean(
        declaration.initializer,
        typeChecker,
        new Set([...visitedSymbols, symbol]),
      );
    }
  }
  return null;
};

const getListenerCapture = (
  optionsExpression: ts.Expression | undefined,
  typeChecker: ts.TypeChecker,
): boolean | null => {
  if (!optionsExpression) return false;
  const directBoolean = getStaticBoolean(optionsExpression, typeChecker);
  if (directBoolean !== null) return directBoolean;
  const unwrappedOptions = unwrapTypescriptExpression(optionsExpression);
  if (!ts.isObjectLiteralExpression(unwrappedOptions)) return null;
  if (
    unwrappedOptions.properties.some(
      (property) =>
        ts.isSpreadAssignment(property) ||
        (property.name && getStaticPropertyName(property.name) === null),
    )
  ) {
    return null;
  }
  const captureProperties = unwrappedOptions.properties.filter(
    (property) => property.name && getStaticPropertyName(property.name) === "capture",
  );
  if (captureProperties.length === 0) return false;
  if (captureProperties.length > 1) return null;
  const captureProperty = captureProperties[0];
  if (!captureProperty) return null;
  if (ts.isPropertyAssignment(captureProperty)) {
    return getStaticBoolean(captureProperty.initializer, typeChecker);
  }
  return ts.isShorthandPropertyAssignment(captureProperty)
    ? getStaticBoolean(captureProperty.name, typeChecker)
    : null;
};

const getListenerSignalController = (
  optionsExpression: ts.Expression | undefined,
  typeChecker: ts.TypeChecker,
): ts.Expression | null => {
  if (!optionsExpression) return null;
  const unwrappedOptions = unwrapTypescriptExpression(optionsExpression);
  if (!ts.isObjectLiteralExpression(unwrappedOptions)) return null;
  const signalProperty = unwrappedOptions.properties.find(
    (property) =>
      ts.isPropertyAssignment(property) && getStaticPropertyName(property.name) === "signal",
  );
  if (
    !signalProperty ||
    !ts.isPropertyAssignment(signalProperty) ||
    !ts.isPropertyAccessExpression(signalProperty.initializer) ||
    signalProperty.initializer.name.text !== "signal" ||
    !isPlatformMember(signalProperty.initializer.name, "signal", typeChecker)
  ) {
    return null;
  }
  return signalProperty.initializer.expression;
};

const getEventListenerDescriptor = (
  callExpression: ts.CallExpression,
  typeChecker: ts.TypeChecker,
): EventListenerDescriptor | null => {
  if (
    !ts.isPropertyAccessExpression(callExpression.expression) ||
    getPlatformEffectResourceKind(callExpression, typeChecker) !==
      ReactEffectResourceKind.EventListener
  ) {
    return null;
  }
  const targetExpression = callExpression.expression.expression;
  if (!isPlatformResourceValue(targetExpression, typeChecker)) return null;
  const eventExpression = callExpression.arguments[0];
  const handlerExpression = callExpression.arguments[1];
  if (!eventExpression || !handlerExpression) return null;
  return {
    eventExpression,
    handlerExpression,
    capture: getListenerCapture(callExpression.arguments[2], typeChecker),
    signalControllerExpression: getListenerSignalController(
      callExpression.arguments[2],
      typeChecker,
    ),
    targetExpression,
  };
};

const isMatchingAbort = (
  cleanupCall: ts.CallExpression,
  listener: EventListenerDescriptor,
  typeChecker: ts.TypeChecker,
): boolean =>
  Boolean(
    listener.signalControllerExpression &&
    ts.isPropertyAccessExpression(cleanupCall.expression) &&
    cleanupCall.expression.name.text === "abort" &&
    isPlatformMember(cleanupCall.expression.name, "abort", typeChecker) &&
    areImmutableExpressionsIdentical(
      cleanupCall.expression.expression,
      listener.signalControllerExpression,
      typeChecker,
    ),
  );

const isMatchingEventRemoval = (
  cleanupCall: ts.CallExpression,
  listener: EventListenerDescriptor,
  typeChecker: ts.TypeChecker,
): boolean => {
  if (
    !ts.isPropertyAccessExpression(cleanupCall.expression) ||
    cleanupCall.expression.name.text !== "removeEventListener" ||
    !isPlatformMember(cleanupCall.expression.name, "removeEventListener", typeChecker)
  ) {
    return false;
  }
  const cleanupEvent = cleanupCall.arguments[0];
  const cleanupHandler = cleanupCall.arguments[1];
  const cleanupCapture = getListenerCapture(cleanupCall.arguments[2], typeChecker);
  return Boolean(
    cleanupEvent &&
    cleanupHandler &&
    listener.capture !== null &&
    cleanupCapture === listener.capture &&
    areImmutableExpressionsIdentical(
      listener.targetExpression,
      cleanupCall.expression.expression,
      typeChecker,
    ) &&
    areImmutableExpressionsIdentical(listener.eventExpression, cleanupEvent, typeChecker) &&
    areImmutableExpressionsIdentical(listener.handlerExpression, cleanupHandler, typeChecker),
  );
};

const isDefinitelyMismatchedEventRemoval = (
  cleanupCall: ts.CallExpression,
  listener: EventListenerDescriptor,
  typeChecker: ts.TypeChecker,
): boolean => {
  if (
    !ts.isPropertyAccessExpression(cleanupCall.expression) ||
    cleanupCall.expression.name.text !== "removeEventListener" ||
    !isPlatformMember(cleanupCall.expression.name, "removeEventListener", typeChecker)
  ) {
    return false;
  }
  const cleanupEvent = cleanupCall.arguments[0];
  const cleanupHandler = cleanupCall.arguments[1];
  if (
    !cleanupEvent ||
    !cleanupHandler ||
    !areImmutableExpressionsIdentical(
      listener.targetExpression,
      cleanupCall.expression.expression,
      typeChecker,
    ) ||
    !areImmutableExpressionsIdentical(listener.eventExpression, cleanupEvent, typeChecker)
  ) {
    return false;
  }
  const cleanupCapture = getListenerCapture(cleanupCall.arguments[2], typeChecker);
  if (listener.capture !== null && cleanupCapture !== null && listener.capture !== cleanupCapture) {
    return true;
  }
  return (
    (ts.isArrowFunction(listener.handlerExpression) ||
      ts.isFunctionExpression(listener.handlerExpression)) &&
    (ts.isArrowFunction(cleanupHandler) || ts.isFunctionExpression(cleanupHandler)) &&
    listener.handlerExpression !== cleanupHandler
  );
};

const getImmutableResourceExpression = (newExpression: ts.NewExpression): ts.Expression | null => {
  const declaration = ts.isVariableDeclaration(newExpression.parent) ? newExpression.parent : null;
  if (
    !declaration ||
    declaration.initializer !== newExpression ||
    !ts.isIdentifier(declaration.name) ||
    !ts.isVariableDeclarationList(declaration.parent) ||
    !(declaration.parent.flags & ts.NodeFlags.Const)
  ) {
    return null;
  }
  return declaration.name;
};

const collectObservers = (
  effectCallback: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<ObserverDescriptor> => {
  const observers: ObserverDescriptor[] = [];
  const constructorsBySymbol = new Map<ts.Symbol, ObserverDescriptor>();
  for (const reachableFunction of collectReachableFunctions(effectCallback, typeChecker)) {
    const visit = (node: ts.Node): void => {
      if (node !== reachableFunction.functionNode && ts.isFunctionLike(node)) return;
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
        const kind = PLATFORM_OBSERVER_KINDS.get(node.expression.text);
        const resourceExpression = kind ? getImmutableResourceExpression(node) : null;
        const resourceSymbol = resourceExpression
          ? getResolvedSymbol(resourceExpression, typeChecker)
          : null;
        if (
          kind &&
          resourceExpression &&
          resourceSymbol &&
          isPlatformMember(node.expression, node.expression.text, typeChecker)
        ) {
          constructorsBySymbol.set(resourceSymbol, {
            activationCalls: [],
            callbackExpression: node.arguments?.[0] ?? null,
            kind,
            resourceExpression,
          });
        }
      }
      node.forEachChild(visit);
    };
    reachableFunction.functionNode.forEachChild(visit);
  }
  for (const callExpression of collectReachableCallExpressions(effectCallback, typeChecker)) {
    const resourceKind = getPlatformEffectResourceKind(callExpression, typeChecker);
    if (
      !ts.isPropertyAccessExpression(callExpression.expression) ||
      !resourceKind ||
      !ts.isIdentifier(callExpression.expression.expression)
    ) {
      continue;
    }
    const resourceSymbol = getResolvedSymbol(callExpression.expression.expression, typeChecker);
    const observer = resourceSymbol ? constructorsBySymbol.get(resourceSymbol) : null;
    if (observer?.kind !== resourceKind) continue;
    observer.activationCalls.push(callExpression);
    if (!observers.includes(observer)) observers.push(observer);
  }
  return observers;
};

const getGuaranteedFunctions = (
  cleanupFunction: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): ReadonlySet<ts.FunctionLikeDeclaration> => {
  const graph = collectReachableFunctionGraph(cleanupFunction, typeChecker);
  const guaranteedFunctions = new Set<ts.FunctionLikeDeclaration>([cleanupFunction]);
  let didAddFunction = true;
  while (didAddFunction) {
    didAddFunction = false;
    for (const call of graph.calls) {
      if (
        guaranteedFunctions.has(call.sourceFunctionNode) &&
        !guaranteedFunctions.has(call.targetFunctionNode) &&
        isEntryDominatingNode(call.callExpression, call.sourceFunctionNode)
      ) {
        guaranteedFunctions.add(call.targetFunctionNode);
        didAddFunction = true;
      }
    }
  }
  return guaranteedFunctions;
};

const isGuaranteedCleanupCall = (
  callExpression: ts.CallExpression,
  guaranteedFunctions: ReadonlySet<ts.FunctionLikeDeclaration>,
): boolean => {
  const ownerFunction = getEnclosingFunction(callExpression);
  return Boolean(
    ownerFunction &&
    guaranteedFunctions.has(ownerFunction) &&
    isEntryDominatingNode(callExpression, ownerFunction),
  );
};

const getDisposalStatus = (
  cleanupFunctions: ReadonlyArray<ts.FunctionLikeDeclaration>,
  hasGuaranteedCleanup: boolean,
  isAcquisitionConditional: boolean,
  isMatchingDisposal: (callExpression: ts.CallExpression) => boolean,
  isDefinitelyMismatchedDisposal: (callExpression: ts.CallExpression) => boolean,
  typeChecker: ts.TypeChecker,
): EffectResourceDisposal => {
  if (cleanupFunctions.length === 0 || !hasGuaranteedCleanup) {
    return {
      calls: [],
      status: isAcquisitionConditional
        ? ReactEffectResourceDisposalStatus.Unknown
        : ReactEffectResourceDisposalStatus.Missing,
    };
  }
  const disposalCalls: ts.CallExpression[] = [];
  for (const cleanupFunction of cleanupFunctions) {
    const guaranteedFunctions = getGuaranteedFunctions(cleanupFunction, typeChecker);
    const cleanupCalls = collectReachableCallExpressions(cleanupFunction, typeChecker);
    const matchingCalls = cleanupCalls.filter(isMatchingDisposal);
    const guaranteedCall = matchingCalls.find((cleanupCall) =>
      isGuaranteedCleanupCall(cleanupCall, guaranteedFunctions),
    );
    if (!guaranteedCall) {
      const hasDefiniteMismatch = cleanupCalls.some(isDefinitelyMismatchedDisposal);
      const isDefinitelyMissing =
        cleanupCalls.length === 0 ||
        hasDefiniteMismatch ||
        (matchingCalls.length > 0 && !isAcquisitionConditional);
      return {
        calls: [...disposalCalls, ...matchingCalls],
        status: isDefinitelyMissing
          ? ReactEffectResourceDisposalStatus.Missing
          : ReactEffectResourceDisposalStatus.Unknown,
      };
    }
    disposalCalls.push(guaranteedCall);
  }
  return {
    calls: disposalCalls,
    status: ReactEffectResourceDisposalStatus.Guaranteed,
  };
};

export const collectLifecycleResourceProtocols = (
  setupFunction: ts.FunctionLikeDeclaration,
  cleanupFunctions: ReadonlyArray<ts.FunctionLikeDeclaration>,
  hasGuaranteedCleanup: boolean,
  context: ReactAnalysisContext,
): ReadonlyArray<LifecycleResourceProtocolDescriptor> => {
  const protocols: LifecycleResourceProtocolDescriptor[] = [];
  const reachableFunctions = collectReachableFunctions(setupFunction, context.typeChecker);
  for (const registrationCall of collectReachableCallExpressions(
    setupFunction,
    context.typeChecker,
  )) {
    const listener = getEventListenerDescriptor(registrationCall, context.typeChecker);
    if (!listener) continue;
    const ownerFunction = getEnclosingFunction(registrationCall);
    const reachableOwner = ownerFunction
      ? reachableFunctions.find(
          (reachableFunction) => reachableFunction.functionNode === ownerFunction,
        )
      : null;
    const isAcquisitionConditional = Boolean(
      !ownerFunction ||
      reachableOwner?.isConditionallyReached ||
      hasConditionalAncestor(registrationCall, ownerFunction),
    );
    const disposal = getDisposalStatus(
      cleanupFunctions,
      hasGuaranteedCleanup,
      isAcquisitionConditional,
      (cleanupCall) =>
        isMatchingEventRemoval(cleanupCall, listener, context.typeChecker) ||
        isMatchingAbort(cleanupCall, listener, context.typeChecker),
      (cleanupCall) =>
        isDefinitelyMismatchedEventRemoval(cleanupCall, listener, context.typeChecker),
      context.typeChecker,
    );
    protocols.push({
      acquisitionNode: registrationCall,
      acquisitionNodes: [registrationCall],
      callbackExpression: listener.handlerExpression,
      disposalCalls: disposal.calls,
      disposalStatus: disposal.status,
      isSourceComplete:
        listener.capture !== null &&
        disposal.status === ReactEffectResourceDisposalStatus.Guaranteed,
      kind: ReactEffectResourceKind.EventListener,
    });
  }
  for (const observer of collectObservers(setupFunction, context.typeChecker)) {
    const observerActivation = observer.activationCalls[0];
    if (!observerActivation) continue;
    const ownerFunction = getEnclosingFunction(observerActivation);
    const reachableOwner = ownerFunction
      ? reachableFunctions.find(
          (reachableFunction) => reachableFunction.functionNode === ownerFunction,
        )
      : null;
    const isAcquisitionConditional = Boolean(
      !ownerFunction ||
      reachableOwner?.isConditionallyReached ||
      hasConditionalAncestor(observerActivation, ownerFunction),
    );
    const disposal = getDisposalStatus(
      cleanupFunctions,
      hasGuaranteedCleanup,
      isAcquisitionConditional,
      (cleanupCall) =>
        ts.isPropertyAccessExpression(cleanupCall.expression) &&
        cleanupCall.expression.name.text === "disconnect" &&
        isPlatformMember(cleanupCall.expression.name, "disconnect", context.typeChecker) &&
        areImmutableExpressionsIdentical(
          cleanupCall.expression.expression,
          observer.resourceExpression,
          context.typeChecker,
        ),
      () => false,
      context.typeChecker,
    );
    protocols.push({
      acquisitionNode: observerActivation,
      acquisitionNodes: observer.activationCalls,
      callbackExpression: observer.callbackExpression,
      disposalCalls: disposal.calls,
      disposalStatus: disposal.status,
      isSourceComplete:
        Boolean(observer.callbackExpression) &&
        disposal.status === ReactEffectResourceDisposalStatus.Guaranteed,
      kind: observer.kind,
    });
  }
  return protocols;
};

export const collectEffectResourceProtocols = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReadonlyArray<EffectResourceProtocolDescriptor> => {
  const protocols: EffectResourceProtocolDescriptor[] = [];
  for (const effectCall of collectEffectCalls(functionNode, context.typeChecker)) {
    const effectCallback = getEffectCallback(effectCall, context.typeChecker);
    if (!effectCallback) continue;
    const cleanupFunctions = collectEffectCleanupFunctions(effectCallback, context.typeChecker);
    protocols.push(
      ...collectLifecycleResourceProtocols(
        effectCallback,
        cleanupFunctions,
        hasGuaranteedEffectCleanup(effectCallback, context.typeChecker),
        context,
      ).map((protocol) => ({ ...protocol, effectCall })),
    );
  }
  return protocols;
};
