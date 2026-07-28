import ts from "typescript";
import { collectExternalStoreProtocolVariants } from "./collect-external-store-protocol-variants.js";
import { collectHookCalls } from "./collect-hook-calls.js";
import { REACT_EXTERNAL_STORE_HOOK_NAMES } from "./constants.js";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import { getComponentPropName } from "./get-component-prop-name.js";
import { getNodeLocation } from "./get-node-location.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { resolveFunction } from "./resolve-function.js";
import { ReactObligationStatus, ReactProofClaim } from "./types.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";
import { collectSymbolWrites } from "./utils/collect-symbol-writes.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofObligation,
  ReactUnitDescriptor,
} from "./types.js";

interface SubscriptionRegistry {
  expressionText: string;
  symbol: ts.Symbol | null;
}

interface SubscriptionAnalysis {
  registries: ReadonlyArray<SubscriptionRegistry>;
  violations: ReadonlyArray<ReactProofEvidence>;
  unknownEvidence: ReadonlyArray<ReactProofEvidence>;
}

const collectReturnExpressions = (
  functionNode: ts.FunctionLikeDeclaration,
): ReadonlyArray<ts.Expression> => {
  if (!functionNode.body) return [];
  if (!ts.isBlock(functionNode.body)) return [functionNode.body];
  const returnExpressions: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== functionNode.body && isFunctionBoundary(node)) return;
    if (ts.isReturnStatement(node) && node.expression) {
      returnExpressions.push(node.expression);
      return;
    }
    node.forEachChild(visit);
  };
  functionNode.body.forEachChild(visit);
  return returnExpressions;
};

const hasGuaranteedReturn = (functionNode: ts.FunctionLikeDeclaration): boolean => {
  if (!functionNode.body) return false;
  if (!ts.isBlock(functionNode.body)) return true;
  const finalStatement = functionNode.body.statements.at(-1);
  return Boolean(finalStatement && ts.isReturnStatement(finalStatement));
};

const collectDirectCalls = (
  functionNode: ts.FunctionLikeDeclaration,
): ReadonlyArray<ts.CallExpression> => {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== functionNode && isFunctionBoundary(node)) return;
    if (ts.isCallExpression(node)) calls.push(node);
    node.forEachChild(visit);
  };
  functionNode.forEachChild(visit);
  return calls;
};

const analyzeSubscription = (
  subscribeFunction: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): SubscriptionAnalysis => {
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  const callbackParameter = subscribeFunction.parameters[0];
  const callbackSymbol =
    callbackParameter && ts.isIdentifier(callbackParameter.name)
      ? context.typeChecker.getSymbolAtLocation(callbackParameter.name)
      : undefined;
  const cleanupExpressions = collectReturnExpressions(subscribeFunction);
  const subscriptionCalls = collectDirectCalls(subscribeFunction);
  const cleanupFunctions = cleanupExpressions
    .map((expression) => resolveFunction(expression, context.typeChecker))
    .filter((cleanupFunction) => cleanupFunction !== null);
  if (
    !callbackSymbol ||
    !hasGuaranteedReturn(subscribeFunction) ||
    cleanupExpressions.length === 0 ||
    cleanupFunctions.length !== cleanupExpressions.length
  ) {
    violations.push(
      createEvidence(
        subscribeFunction,
        context.rootDirectory,
        "The external-store subscribe function does not return cleanup on every normal path",
        ["useSyncExternalStore", "subscribe", "missing unsubscribe function", "retained listener"],
      ),
    );
  }

  const registries: SubscriptionRegistry[] = [];
  const modeledSubscriptionCalls = new Set<ts.CallExpression>();
  for (const callExpression of subscriptionCalls) {
    if (
      !ts.isPropertyAccessExpression(callExpression.expression) ||
      callExpression.expression.name.text !== "add"
    ) {
      continue;
    }
    const registeredCallback = callExpression.arguments[0];
    if (
      !registeredCallback ||
      context.typeChecker.getSymbolAtLocation(registeredCallback) !== callbackSymbol
    ) {
      continue;
    }
    const registryExpression = callExpression.expression.expression;
    const registry: SubscriptionRegistry = {
      expressionText: registryExpression.getText(),
      symbol: context.typeChecker.getSymbolAtLocation(registryExpression) ?? null,
    };
    modeledSubscriptionCalls.add(callExpression);
    registries.push(registry);
    const hasMatchingCleanup = cleanupFunctions.some((cleanupFunction) =>
      collectDirectCalls(cleanupFunction).some(
        (cleanupCall) =>
          ts.isPropertyAccessExpression(cleanupCall.expression) &&
          cleanupCall.expression.name.text === "delete" &&
          cleanupCall.expression.expression.getText() === registry.expressionText &&
          cleanupCall.arguments[0] !== undefined &&
          context.typeChecker.getSymbolAtLocation(cleanupCall.arguments[0]) === callbackSymbol,
      ),
    );
    if (!hasMatchingCleanup) {
      violations.push(
        createEvidence(
          callExpression,
          context.rootDirectory,
          `${registry.expressionText}.add subscribes the React callback without symmetric deletion`,
          [
            "useSyncExternalStore",
            `${registry.expressionText}.add(callback)`,
            "subscription lifetime",
            `${registry.expressionText}.delete(callback)`,
          ],
        ),
      );
    }
  }

  if (subscriptionCalls.some((callExpression) => !modeledSubscriptionCalls.has(callExpression))) {
    unknownEvidence.push(
      createEvidence(
        subscribeFunction,
        context.rootDirectory,
        "The external-store subscription protocol is not a modeled listener registry",
        ["useSyncExternalStore", "subscribe", "opaque notification protocol"],
      ),
    );
  }
  return { registries, violations, unknownEvidence };
};

const isFreshSnapshot = (expression: ts.Expression): boolean => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  return (
    ts.isArrayLiteralExpression(unwrappedExpression) ||
    ts.isObjectLiteralExpression(unwrappedExpression) ||
    ts.isNewExpression(unwrappedExpression)
  );
};

const isPrimitiveType = (type: ts.Type): boolean => {
  if (type.isUnion()) return type.types.every(isPrimitiveType);
  return Boolean(
    type.flags &
    (ts.TypeFlags.StringLike |
      ts.TypeFlags.NumberLike |
      ts.TypeFlags.BooleanLike |
      ts.TypeFlags.BigIntLike |
      ts.TypeFlags.ESSymbolLike |
      ts.TypeFlags.Null |
      ts.TypeFlags.Undefined |
      ts.TypeFlags.EnumLike),
  );
};

const isStablePrimitiveExpression = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
): boolean => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (!isPrimitiveType(typeChecker.getTypeAtLocation(unwrappedExpression))) return false;
  if (
    ts.isIdentifier(unwrappedExpression) ||
    ts.isLiteralExpression(unwrappedExpression) ||
    unwrappedExpression.kind === ts.SyntaxKind.TrueKeyword ||
    unwrappedExpression.kind === ts.SyntaxKind.FalseKeyword ||
    unwrappedExpression.kind === ts.SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (ts.isPrefixUnaryExpression(unwrappedExpression)) {
    if (
      unwrappedExpression.operator === ts.SyntaxKind.PlusPlusToken ||
      unwrappedExpression.operator === ts.SyntaxKind.MinusMinusToken
    ) {
      return false;
    }
    return isStablePrimitiveExpression(unwrappedExpression.operand, typeChecker);
  }
  if (ts.isBinaryExpression(unwrappedExpression)) {
    if (
      unwrappedExpression.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      unwrappedExpression.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      return false;
    }
    return (
      isStablePrimitiveExpression(unwrappedExpression.left, typeChecker) &&
      isStablePrimitiveExpression(unwrappedExpression.right, typeChecker)
    );
  }
  if (ts.isConditionalExpression(unwrappedExpression)) {
    return (
      isStablePrimitiveExpression(unwrappedExpression.condition, typeChecker) &&
      isStablePrimitiveExpression(unwrappedExpression.whenTrue, typeChecker) &&
      isStablePrimitiveExpression(unwrappedExpression.whenFalse, typeChecker)
    );
  }
  return false;
};

const isStaticPrimitiveExpression = (expression: ts.Expression): boolean => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  return (
    ts.isLiteralExpression(unwrappedExpression) ||
    unwrappedExpression.kind === ts.SyntaxKind.TrueKeyword ||
    unwrappedExpression.kind === ts.SyntaxKind.FalseKeyword ||
    unwrappedExpression.kind === ts.SyntaxKind.NullKeyword
  );
};

const getContainingFunction = (node: ts.Node): ts.FunctionLikeDeclaration | null => {
  let currentNode = node.parent;
  while (currentNode) {
    if (isFunctionBoundary(currentNode)) return currentNode;
    currentNode = currentNode.parent;
  }
  return null;
};

const hasRegistryNotificationAfterWrite = (
  write: ts.Node,
  registry: SubscriptionRegistry,
  context: ReactAnalysisContext,
): boolean => {
  const containingFunction = getContainingFunction(write);
  if (!containingFunction) return false;
  let hasNotification = false;
  const visit = (node: ts.Node): void => {
    if (hasNotification || (node !== containingFunction && isFunctionBoundary(node))) return;
    if (
      ts.isForOfStatement(node) &&
      node.getStart() > write.getEnd() &&
      ((registry.symbol &&
        context.typeChecker.getSymbolAtLocation(node.expression) === registry.symbol) ||
        node.expression.getText() === registry.expressionText) &&
      ts.isVariableDeclarationList(node.initializer)
    ) {
      const listenerDeclaration = node.initializer.declarations[0];
      const listenerSymbol =
        listenerDeclaration && ts.isIdentifier(listenerDeclaration.name)
          ? context.typeChecker.getSymbolAtLocation(listenerDeclaration.name)
          : undefined;
      const inspectLoopBody = (loopNode: ts.Node): void => {
        if (
          ts.isCallExpression(loopNode) &&
          listenerSymbol &&
          context.typeChecker.getSymbolAtLocation(loopNode.expression) === listenerSymbol
        ) {
          hasNotification = true;
          return;
        }
        loopNode.forEachChild(inspectLoopBody);
      };
      node.statement.forEachChild(inspectLoopBody);
    }
    node.forEachChild(visit);
  };
  containingFunction.forEachChild(visit);
  return hasNotification;
};

const analyzeSnapshotWrites = (
  snapshotExpressions: ReadonlyArray<ts.Expression>,
  registries: ReadonlyArray<SubscriptionRegistry>,
  context: ReactAnalysisContext,
): ReadonlyArray<ReactProofEvidence> => {
  const violations: ReactProofEvidence[] = [];
  const snapshotSymbols = new Set(
    snapshotExpressions
      .map((expression) =>
        context.typeChecker.getSymbolAtLocation(unwrapTypescriptExpression(expression)),
      )
      .filter((symbol) => symbol !== undefined),
  );
  for (const snapshotSymbol of snapshotSymbols) {
    for (const declaration of snapshotSymbol.declarations ?? []) {
      const writes = collectSymbolWrites(
        snapshotSymbol,
        declaration.getSourceFile(),
        context.typeChecker,
      );
      for (const write of writes) {
        if (
          registries.some((registry) => hasRegistryNotificationAfterWrite(write, registry, context))
        ) {
          continue;
        }
        violations.push(
          createEvidence(
            write,
            context.rootDirectory,
            `${snapshotSymbol.name} changes without notifying the subscribed React callback`,
            [
              "external store write",
              snapshotSymbol.name,
              "missing listener notification",
              "stale rendered snapshot",
            ],
          ),
        );
      }
      break;
    }
  }
  return violations;
};

export const analyzeExternalStoreConsistency = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const functionNode = unit.functionNode;
  if (!functionNode) {
    return createObligation(
      ReactProofClaim.ExternalStoreConsistency,
      ReactObligationStatus.Unknown,
      "The unit has no function boundary for an external-store proof",
    );
  }
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  const semanticOwnerId = findSemanticUnit(unit, context)?.id;
  for (const hookCall of collectHookCalls(
    functionNode,
    REACT_EXTERNAL_STORE_HOOK_NAMES,
    context.typeChecker,
  )) {
    const subscribeExpression = hookCall.arguments[0];
    const snapshotExpression = hookCall.arguments[1];
    const serverSnapshotExpression = hookCall.arguments[2];
    const hookLocation = getNodeLocation(hookCall, context.rootDirectory);
    const externalStore = context.graph?.externalStores.find(
      (store) =>
        store.ownerId === semanticOwnerId &&
        store.location.filePath === hookLocation.filePath &&
        store.location.line === hookLocation.line &&
        store.location.column === hookLocation.column,
    );
    if (!externalStore) {
      unknownEvidence.push(
        createEvidence(
          hookCall,
          context.rootDirectory,
          "The external-store subscribe or snapshot callback cannot be resolved",
          ["useSyncExternalStore", "opaque callback", "external consistency boundary"],
        ),
      );
      continue;
    }
    const subscribePropName = subscribeExpression
      ? getComponentPropName(subscribeExpression, functionNode, context.typeChecker)
      : null;
    const snapshotPropName = snapshotExpression
      ? getComponentPropName(snapshotExpression, functionNode, context.typeChecker)
      : null;
    const serverSnapshotPropName = serverSnapshotExpression
      ? getComponentPropName(serverSnapshotExpression, functionNode, context.typeChecker)
      : null;
    const protocolVariants = collectExternalStoreProtocolVariants({
      context,
      externalStore,
      serverSnapshotPropName,
      snapshotPropName,
      subscribePropName,
    });
    if (protocolVariants.length === 0) {
      unknownEvidence.push(
        createEvidence(
          hookCall,
          context.rootDirectory,
          "The external-store render variants cannot be correlated",
          ["useSyncExternalStore", "callback prop flows", "unknown render source"],
        ),
      );
      continue;
    }
    for (const protocolVariant of protocolVariants) {
      if (
        !protocolVariant.isComplete ||
        protocolVariant.subscribeFunctions.length !== 1 ||
        protocolVariant.snapshotFunctions.length !== 1 ||
        (serverSnapshotExpression && protocolVariant.serverSnapshotFunctions.length !== 1)
      ) {
        unknownEvidence.push(
          createEvidence(
            hookCall,
            context.rootDirectory,
            "The external-store callbacks within one render variant cannot be resolved",
            [
              "useSyncExternalStore",
              protocolVariant.renderId ?? "local callback channels",
              "opaque or joined callback",
            ],
          ),
        );
        continue;
      }
      const subscribeFunction = protocolVariant.subscribeFunctions[0];
      const snapshotFunction = protocolVariant.snapshotFunctions[0];
      if (!subscribeFunction || !snapshotFunction) continue;
      const subscription = analyzeSubscription(subscribeFunction, context);
      violations.push(...subscription.violations);
      unknownEvidence.push(...subscription.unknownEvidence);
      const snapshotExpressions = collectReturnExpressions(snapshotFunction);
      if (
        !hasGuaranteedReturn(snapshotFunction) ||
        snapshotExpressions.length === 0 ||
        snapshotExpressions.some(isFreshSnapshot)
      ) {
        violations.push(
          createEvidence(
            snapshotFunction,
            context.rootDirectory,
            "getSnapshot can produce a fresh or missing value without an external-store change",
            ["useSyncExternalStore", "getSnapshot", "Object.is changed", "render loop"],
          ),
        );
      } else if (
        !snapshotExpressions.every((expression) =>
          isStablePrimitiveExpression(expression, context.typeChecker),
        )
      ) {
        unknownEvidence.push(
          createEvidence(
            snapshotFunction,
            context.rootDirectory,
            "getSnapshot immutability and referential stability could not be proved",
            ["useSyncExternalStore", "getSnapshot", "opaque snapshot identity"],
          ),
        );
      }
      violations.push(
        ...analyzeSnapshotWrites(snapshotExpressions, subscription.registries, context),
      );
      if (serverSnapshotExpression) {
        const serverSnapshotFunction = protocolVariant.serverSnapshotFunctions[0];
        const serverExpressions = serverSnapshotFunction
          ? collectReturnExpressions(serverSnapshotFunction)
          : [];
        const hasMatchingServerSnapshot =
          serverSnapshotFunction &&
          hasGuaranteedReturn(serverSnapshotFunction) &&
          serverExpressions.length === snapshotExpressions.length &&
          serverExpressions.every(
            (expression, expressionIndex) =>
              isStablePrimitiveExpression(expression, context.typeChecker) &&
              context.typeChecker.getSymbolAtLocation(unwrapTypescriptExpression(expression)) ===
                context.typeChecker.getSymbolAtLocation(
                  unwrapTypescriptExpression(snapshotExpressions[expressionIndex]),
                ) &&
              expression.getText() === snapshotExpressions[expressionIndex]?.getText(),
          );
        if (!hasMatchingServerSnapshot) {
          const hasStaticMismatch =
            serverExpressions.length === snapshotExpressions.length &&
            serverExpressions.every(isStaticPrimitiveExpression) &&
            snapshotExpressions.every(isStaticPrimitiveExpression) &&
            serverExpressions.some(
              (expression, expressionIndex) =>
                expression.getText() !== snapshotExpressions[expressionIndex]?.getText(),
            );
          const evidence = createEvidence(
            serverSnapshotExpression,
            context.rootDirectory,
            hasStaticMismatch
              ? "getServerSnapshot returns different initial data than getSnapshot"
              : "The server snapshot cannot be proved identical during hydration",
            ["server render", "getServerSnapshot", "client hydration", "snapshot identity"],
          );
          if (hasStaticMismatch) {
            violations.push(evidence);
          } else {
            unknownEvidence.push(evidence);
          }
        }
      }
    }
  }

  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.ExternalStoreConsistency,
      ReactObligationStatus.Violated,
      "An external store violates subscription or snapshot consistency",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.ExternalStoreConsistency,
      ReactObligationStatus.Unknown,
      "External-store consistency could not be proved",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.ExternalStoreConsistency,
    ReactObligationStatus.Proved,
    "External-store snapshots are stable and every modeled mutation notifies a symmetric subscription",
  );
};
