import * as path from "node:path";
import ts from "typescript";
import {
  REACT_EVENT_PROP_PATTERN,
  REACT_RUNTIME_MODULE_NAMES,
  REACT_USE_TRANSITION_TUPLE_LENGTH,
  REACT_UNMODELED_HOOK_NAMES,
} from "./constants.js";
import { getCallableRefProtocolForCurrentAccess } from "./collect-callable-ref-protocols.js";
import { getPlatformSchedulerKind } from "./collect-effect-scheduler-protocols.js";
import { collectReachableFunctionGraph } from "./collect-reachable-functions.js";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { getCanonicalHookName } from "./get-canonical-hook-name.js";
import { getCanonicalReactApiName } from "./get-canonical-react-api-name.js";
import { getCallName } from "./get-call-name.js";
import { getComponentPropName } from "./get-component-prop-name.js";
import { getNodeLocation } from "./get-node-location.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { isComponentPropExpression } from "./is-component-prop-expression.js";
import { isReactContextExpression } from "./is-react-context-expression.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";
import { doesTypeContainCallable } from "./resolve-callable-expression.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import {
  ReactExecutionPhase,
  ReactObligationStatus,
  ReactProofClaim,
  ReactUnitKind,
} from "./types.js";
import { areProofLocationsEqual } from "./utils/are-proof-locations-equal.js";
import { collectJsxSpreadProperties } from "./utils/collect-jsx-spread-properties.js";
import { isEffectiveJsxPropertySource } from "./utils/is-effective-jsx-property-source.js";
import { isIntrinsicJsxElement } from "./utils/is-intrinsic-jsx-element.js";
import { isAssignmentOperator } from "./utils/is-assignment-operator.js";
import { isJsxSpreadSourceComplete } from "./utils/is-jsx-spread-source-complete.js";
import { getPlatformEffectResourceKind } from "./utils/get-platform-effect-resource-kind.js";
import type {
  ReactAnalysisContext,
  ReactProofEvidence,
  ReactProofObligation,
  ReactUnitDescriptor,
} from "./types.js";

const isRuntimeImport = (importDeclaration: ts.ImportDeclaration): boolean => {
  const importClause = importDeclaration.importClause;
  if (!importClause || importClause.isTypeOnly) return false;
  if (importClause.name) return true;
  if (!importClause.namedBindings) return false;
  if (ts.isNamespaceImport(importClause.namedBindings)) return true;
  return importClause.namedBindings.elements.some((element) => !element.isTypeOnly);
};

const isProjectModule = (
  moduleSpecifier: ts.StringLiteral,
  context: ReactAnalysisContext,
): boolean => {
  const moduleSymbol = context.typeChecker.getSymbolAtLocation(moduleSpecifier);
  if (!moduleSymbol) return moduleSpecifier.text.startsWith(".");
  return Boolean(
    moduleSymbol.declarations?.some((declaration) => {
      const sourceFileName = declaration.getSourceFile().fileName;
      return (
        !sourceFileName.includes(`${path.sep}node_modules${path.sep}`) &&
        path.relative(context.rootDirectory, sourceFileName).split(path.sep)[0] !== ".."
      );
    }),
  );
};

export const analyzeBoundaryCoverage = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const functionNode = unit.functionNode;
  if (!functionNode) {
    return createObligation(
      ReactProofClaim.BoundaryCoverage,
      ReactObligationStatus.Unknown,
      "The unit has no function boundary to analyze",
    );
  }
  const unknownEvidence: ReactProofEvidence[] = [];
  const sourceFile = functionNode.getSourceFile();
  const isComponentUnit = unit.kind === ReactUnitKind.Component;
  const semanticOwnerId = findSemanticUnit(unit, context)?.id;
  const isCompleteCallableRefAccess = (accessExpression: ts.PropertyAccessExpression): boolean => {
    const protocol = getCallableRefProtocolForCurrentAccess(accessExpression, context.typeChecker);
    if (!protocol) return false;
    const protocolLocation = getNodeLocation(protocol.declaration, context.rootDirectory);
    return Boolean(
      context.graph?.callableRefs.some(
        (callableRef) =>
          callableRef.ownerId === semanticOwnerId &&
          areProofLocationsEqual(callableRef.location, protocolLocation) &&
          callableRef.complete,
      ),
    );
  };
  const isModeledCallbackPropInvocation = (
    callExpression: ts.CallExpression,
    propName: string,
  ): boolean => {
    if (!context.graph || !semanticOwnerId) return false;
    const location = getNodeLocation(callExpression, context.rootDirectory);
    return context.graph.callbackPropFlows.some(
      (propFlow) =>
        propFlow.targetOwnerId === semanticOwnerId &&
        propFlow.propName === propName &&
        propFlow.complete &&
        context.graph?.functionCalls.some(
          (functionCall) =>
            functionCall.ownerId === semanticOwnerId &&
            functionCall.phase === propFlow.phase &&
            functionCall.location.filePath === location.filePath &&
            functionCall.location.line === location.line &&
            functionCall.location.column === location.column,
        ),
    );
  };
  const isCompleteEventFlow = (attribute: ts.JsxAttributeLike, eventName: string): boolean => {
    const location = getNodeLocation(attribute, context.rootDirectory);
    return Boolean(
      context.graph &&
      (context.graph.eventBindings.some(
        (eventBinding) =>
          eventBinding.ownerId === semanticOwnerId &&
          eventBinding.eventName === eventName &&
          eventBinding.complete &&
          eventBinding.location.filePath === location.filePath &&
          eventBinding.location.line === location.line &&
          eventBinding.location.column === location.column,
      ) ||
        context.graph.callbackPropFlows.some(
          (propFlow) =>
            propFlow.renderOwnerId === semanticOwnerId &&
            propFlow.propName === eventName &&
            propFlow.phase === ReactExecutionPhase.Event &&
            propFlow.complete &&
            propFlow.location.filePath === location.filePath &&
            propFlow.location.line === location.line &&
            propFlow.location.column === location.column,
        )),
    );
  };
  const isModeledUseTransitionCall = (callExpression: ts.CallExpression): boolean => {
    if (callExpression.arguments.length > 0) return false;
    const declaration = ts.isVariableDeclaration(callExpression.parent)
      ? callExpression.parent
      : null;
    if (
      !declaration ||
      declaration.initializer !== callExpression ||
      !ts.isArrayBindingPattern(declaration.name) ||
      declaration.name.elements.length > REACT_USE_TRANSITION_TUPLE_LENGTH
    ) {
      return false;
    }
    return declaration.name.elements.every(
      (element) =>
        ts.isOmittedExpression(element) ||
        (ts.isBindingElement(element) && !element.dotDotDotToken && ts.isIdentifier(element.name)),
    );
  };
  const getModeledTransitionAction = (node: ts.Node) => {
    let actionExpression: ts.Node = node;
    while (
      actionExpression.parent &&
      ts.isExpression(actionExpression.parent) &&
      unwrapTypescriptExpression(actionExpression.parent) === node
    ) {
      actionExpression = actionExpression.parent;
    }
    let callExpression: ts.CallExpression | null = ts.isCallExpression(node) ? node : null;
    if (
      actionExpression.parent &&
      ts.isCallExpression(actionExpression.parent) &&
      actionExpression.parent.arguments.some((argument) => argument === actionExpression)
    ) {
      callExpression = actionExpression.parent;
    }
    if (!callExpression) return null;
    const location = getNodeLocation(callExpression, context.rootDirectory);
    return (
      context.graph?.transitionActions.find((action) =>
        areProofLocationsEqual(action.location, location),
      ) ?? null
    );
  };
  const isModeledExternalStorePropForwarding = (
    callExpression: ts.CallExpression,
    argument: ts.Expression,
    propName: string,
  ): boolean => {
    if (
      !context.graph ||
      !semanticOwnerId ||
      getCanonicalHookName(callExpression, context.typeChecker) !== "useSyncExternalStore"
    ) {
      return false;
    }
    const location = getNodeLocation(callExpression, context.rootDirectory);
    const externalStore = context.graph.externalStores.find(
      (store) =>
        store.ownerId === semanticOwnerId &&
        store.location.filePath === location.filePath &&
        store.location.line === location.line &&
        store.location.column === location.column,
    );
    if (!externalStore) return false;
    const argumentIndex = callExpression.arguments.indexOf(argument);
    let phase: ReactExecutionPhase | null = null;
    let callbackIds: ReadonlyArray<string> = [];
    let isComplete = false;
    if (argumentIndex === 0) {
      phase = ReactExecutionPhase.ExternalStoreSubscription;
      callbackIds = externalStore.subscribeCallbackIds;
      isComplete = externalStore.subscribeComplete;
    } else if (argumentIndex === 1) {
      phase = ReactExecutionPhase.Render;
      callbackIds = externalStore.snapshotCallbackIds;
      isComplete = externalStore.snapshotComplete;
    } else if (argumentIndex === 2) {
      phase = ReactExecutionPhase.ServerRender;
      callbackIds = externalStore.serverSnapshotCallbackIds;
      isComplete = externalStore.serverSnapshotComplete;
    }
    if (!phase || !isComplete || callbackIds.length === 0) return false;
    return context.graph.callbackPropFlows.some(
      (propFlow) =>
        propFlow.targetOwnerId === semanticOwnerId &&
        propFlow.propName === propName &&
        propFlow.phase === phase &&
        propFlow.complete &&
        propFlow.callbackIds.length > 0 &&
        propFlow.callbackIds.every((callbackId) => callbackIds.includes(callbackId)),
    );
  };
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      isRuntimeImport(statement) &&
      !REACT_RUNTIME_MODULE_NAMES.has(statement.moduleSpecifier.text) &&
      !isProjectModule(statement.moduleSpecifier, context)
    ) {
      const moduleSource = statement.moduleSpecifier.text;
      unknownEvidence.push(
        createEvidence(
          statement,
          context.rootDirectory,
          `The ${moduleSource} module has no React proof contract`,
          ["application", `import ${moduleSource}`, "opaque boundary"],
        ),
      );
    }
  }

  const unitExecutionRoots = unit.classNode
    ? unit.classNode.members.filter(ts.isMethodDeclaration)
    : [functionNode];
  const executionRoots = new Set<ts.FunctionLikeDeclaration>(unitExecutionRoots);
  const collectExecutionRoots = (node: ts.Node): void => {
    if (isFunctionBoundary(node)) executionRoots.add(node);
    node.forEachChild(collectExecutionRoots);
  };
  for (const executionRoot of unitExecutionRoots) {
    executionRoot.forEachChild(collectExecutionRoots);
  }
  const unmodeledCallableUseLocations = new Set<string>();
  for (const executionRoot of executionRoots) {
    const reachabilityGraph = collectReachableFunctionGraph(executionRoot, context.typeChecker);
    for (const unmodeledUse of reachabilityGraph.unmodeledCallableUses) {
      if (getModeledTransitionAction(unmodeledUse.node)?.sourceComplete) continue;
      const location = unmodeledUse.node.getStart();
      const locationKey = `${unmodeledUse.node.getSourceFile().fileName}:${location}`;
      if (unmodeledCallableUseLocations.has(locationKey)) continue;
      unmodeledCallableUseLocations.add(locationKey);
      const parameterDescription =
        unmodeledUse.parameterIndex === null
          ? "A captured callback value"
          : `Callback parameter ${unmodeledUse.parameterIndex + 1}`;
      unknownEvidence.push(
        createEvidence(
          unmodeledUse.node,
          context.rootDirectory,
          `${parameterDescription} crosses an unmodeled callable-value boundary`,
          [
            "source callback",
            unmodeledUse.parameterIndex === null
              ? "captured callable binding"
              : `parameter ${unmodeledUse.parameterIndex + 1}`,
            unmodeledUse.node.parent.getText(),
            "unknown execution phase or lifetime",
          ],
        ),
      );
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callName = getCallName(node);
      const schedulerKind = getPlatformSchedulerKind(node, context);
      if (schedulerKind) {
        const schedulerLocation = getNodeLocation(node, context.rootDirectory);
        const isModeledScheduler = context.graph?.schedulers.some(
          (scheduler) =>
            scheduler.complete && areProofLocationsEqual(scheduler.location, schedulerLocation),
        );
        if (!isModeledScheduler) {
          unknownEvidence.push(
            createEvidence(
              node,
              context.rootDirectory,
              `${schedulerKind} crosses an unproved deferred callback or cancellation boundary`,
              [schedulerKind, "deferred callback", "unknown phase or lifetime"],
            ),
          );
        }
      }
      const effectResourceKind = getPlatformEffectResourceKind(node, context.typeChecker);
      if (effectResourceKind) {
        const resourceLocation = getNodeLocation(node, context.rootDirectory);
        const isModeledResource = context.graph?.resources.some(
          (resource) =>
            resource.complete &&
            resource.activationLocations.some((activationLocation) =>
              areProofLocationsEqual(activationLocation, resourceLocation),
            ),
        );
        if (!isModeledResource) {
          unknownEvidence.push(
            createEvidence(
              node,
              context.rootDirectory,
              `${effectResourceKind} crosses an unproved callback or disposal boundary`,
              [effectResourceKind, "deferred callback", "unknown phase or lifetime"],
            ),
          );
        }
      }
      const canonicalReactApiName = getCanonicalReactApiName(node.expression, context.typeChecker);
      const isModeledContextRead =
        canonicalReactApiName === "use" &&
        Boolean(
          node.arguments[0] && isReactContextExpression(node.arguments[0], context.typeChecker),
        );
      if (
        canonicalReactApiName &&
        REACT_UNMODELED_HOOK_NAMES.has(canonicalReactApiName) &&
        !isModeledContextRead &&
        !(canonicalReactApiName === "useTransition" && isModeledUseTransitionCall(node))
      ) {
        unknownEvidence.push(
          createEvidence(
            node,
            context.rootDirectory,
            `${canonicalReactApiName} does not yet have a complete lifecycle model`,
            ["render", canonicalReactApiName, "unmodeled React primitive"],
          ),
        );
      }
      const transitionAction = getModeledTransitionAction(node);
      if (transitionAction && !transitionAction.sourceComplete) {
        unknownEvidence.push(
          createEvidence(
            node,
            context.rootDirectory,
            "A Transition Action crosses an unproved callback, async, or state-priority boundary",
            ["Transition Action", transitionAction.status, "incomplete execution model"],
          ),
        );
      }
      if (callName === "eval" || node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        unknownEvidence.push(
          createEvidence(
            node,
            context.rootDirectory,
            `${callName ?? "dynamic import"} prevents closed-world analysis`,
            ["application", callName ?? "dynamic import", "dynamic code boundary"],
          ),
        );
      }
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        getCallableRefProtocolForCurrentAccess(node.expression, context.typeChecker) &&
        !isCompleteCallableRefAccess(node.expression)
      ) {
        unknownEvidence.push(
          createEvidence(
            node,
            context.rootDirectory,
            "A callable ref is invoked without a temporal freshness and ownership proof",
            ["callable ref", node.getText(), "unknown callback version or lifetime"],
          ),
        );
      }
      const callbackPropName = isComponentUnit
        ? getComponentPropName(node.expression, functionNode, context.typeChecker)
        : null;
      if (callbackPropName && !isModeledCallbackPropInvocation(node, callbackPropName)) {
        unknownEvidence.push(
          createEvidence(
            node,
            context.rootDirectory,
            `Callback prop ${callbackPropName} is invoked without a modeled React execution-phase channel`,
            [
              `component prop ${callbackPropName}`,
              node.getText(),
              "unknown execution phase or lifetime",
            ],
          ),
        );
      } else if (
        !callbackPropName &&
        isComponentUnit &&
        isComponentPropExpression(node.expression, functionNode, context.typeChecker)
      ) {
        unknownEvidence.push(
          createEvidence(
            node,
            context.rootDirectory,
            "A computed callback prop is invoked without a statically named phase channel",
            ["component callback prop", node.getText(), "unknown prop identity or lifetime"],
          ),
        );
      }
      for (const argument of node.arguments) {
        const forwardedCallbackPropName = isComponentUnit
          ? getComponentPropName(argument, functionNode, context.typeChecker)
          : null;
        if (
          !forwardedCallbackPropName ||
          !doesTypeContainCallable(
            context.typeChecker.getTypeAtLocation(argument),
            context.typeChecker,
          )
        ) {
          continue;
        }
        if (isModeledExternalStorePropForwarding(node, argument, forwardedCallbackPropName)) {
          continue;
        }
        unknownEvidence.push(
          createEvidence(
            argument,
            context.rootDirectory,
            `Callback prop ${forwardedCallbackPropName} is forwarded without a modeled React execution-phase channel`,
            [
              `component prop ${forwardedCallbackPropName}`,
              node.getText(),
              "unknown execution phase or lifetime",
            ],
          ),
        );
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      isAssignmentOperator(node.operatorToken.kind) &&
      ts.isPropertyAccessExpression(node.left) &&
      !isCompleteCallableRefAccess(node.left) &&
      doesTypeContainCallable(context.typeChecker.getTypeAtLocation(node.left), context.typeChecker)
    ) {
      unknownEvidence.push(
        createEvidence(
          node,
          context.rootDirectory,
          `Callable property ${node.left.getText()} is mutated without an SSA value proof`,
          [node.left.getText(), "callable property write", "unknown subsequent target"],
        ),
      );
    }
    if (
      ts.isJsxAttribute(node) &&
      REACT_EVENT_PROP_PATTERN.test(node.name.getText()) &&
      node.initializer &&
      isEffectiveJsxPropertySource(node, node.name.getText(), context.typeChecker)
    ) {
      if (!isCompleteEventFlow(node, node.name.getText())) {
        unknownEvidence.push(
          createEvidence(
            node,
            context.rootDirectory,
            `${node.name.getText()} does not resolve to a project event callback`,
            ["committed tree", node.name.getText(), "opaque event callback"],
          ),
        );
      }
    }
    if (ts.isJsxSpreadAttribute(node)) {
      const spreadProperties = collectJsxSpreadProperties(node.expression, context.typeChecker);
      const openingElement = node.parent.parent;
      if (!isJsxSpreadSourceComplete(node.expression, functionNode, context.typeChecker)) {
        unknownEvidence.push(
          createEvidence(
            node,
            context.rootDirectory,
            "A JSX spread source does not have an immutable finite object proof",
            ["JSX props", node.getText(), "unknown object evaluation or mutation"],
          ),
        );
      }
      if (spreadProperties.hasUnknownProperties && isIntrinsicJsxElement(openingElement)) {
        unknownEvidence.push(
          createEvidence(
            node,
            context.rootDirectory,
            "A JSX spread has an open-ended property set that can override callback props",
            ["JSX props", node.getText(), "unknown callback property or precedence"],
          ),
        );
      }
      for (const eventName of spreadProperties.callablePropertyNames.filter((propertyName) =>
        REACT_EVENT_PROP_PATTERN.test(propertyName),
      )) {
        if (!isEffectiveJsxPropertySource(node, eventName, context.typeChecker)) continue;
        if (isCompleteEventFlow(node, eventName)) continue;
        unknownEvidence.push(
          createEvidence(
            node,
            context.rootDirectory,
            `${eventName} from a JSX spread does not resolve to a project event callback`,
            ["committed tree", eventName, "opaque spread event callback"],
          ),
        );
      }
    }
    node.forEachChild(visit);
  };
  for (const executionRoot of unitExecutionRoots) {
    executionRoot.forEachChild(visit);
  }
  const semanticUnit = findSemanticUnit(unit, context);
  const classLifecycle = semanticUnit
    ? context.graph?.classLifecycles.find((lifecycle) => lifecycle.ownerId === semanticUnit.id)
    : null;
  if (unit.kind === ReactUnitKind.ClassComponent && !classLifecycle?.sourceComplete) {
    unknownEvidence.push(
      createEvidence(
        unit.classNode ?? unit.node,
        context.rootDirectory,
        "The class lifecycle contains an unmodeled method or ownership transition",
        ["class lifecycle", "unmodeled execution", "unknown phase or lifetime"],
      ),
    );
  }

  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.BoundaryCoverage,
      ReactObligationStatus.Unknown,
      "The unit crosses a React or external boundary without a complete proof model",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.BoundaryCoverage,
    ReactObligationStatus.Proved,
    "Every reachable React and module boundary has a proof model",
  );
};
