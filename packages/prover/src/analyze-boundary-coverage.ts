import * as path from "node:path";
import ts from "typescript";
import {
  REACT_EVENT_PROP_PATTERN,
  REACT_RUNTIME_MODULE_NAMES,
  REACT_UNMODELED_HOOK_NAMES,
} from "./constants.js";
import { collectReachableFunctionGraph } from "./collect-reachable-functions.js";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { getCanonicalHookName } from "./get-canonical-hook-name.js";
import { getCanonicalReactApiName } from "./get-canonical-react-api-name.js";
import { getCallName } from "./get-call-name.js";
import { getComponentPropName } from "./get-component-prop-name.js";
import { getNodeLocation } from "./get-node-location.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { isComponentPropExpression } from "./is-component-prop-expression.js";
import { isReactContextExpression } from "./is-react-context-expression.js";
import { doesTypeContainCallable } from "./resolve-callable-expression.js";
import { findSemanticUnit } from "./find-semantic-unit.js";
import {
  ReactExecutionPhase,
  ReactObligationStatus,
  ReactProofClaim,
  ReactUnitKind,
} from "./types.js";
import { collectJsxSpreadProperties } from "./utils/collect-jsx-spread-properties.js";
import { isEffectiveJsxPropertySource } from "./utils/is-effective-jsx-property-source.js";
import { isIntrinsicJsxElement } from "./utils/is-intrinsic-jsx-element.js";
import { isJsxSpreadSourceComplete } from "./utils/is-jsx-spread-source-complete.js";
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

const isCallableRefInvocation = (
  callExpression: ts.CallExpression,
  typeChecker: ts.TypeChecker,
): boolean => {
  if (
    !ts.isPropertyAccessExpression(callExpression.expression) ||
    callExpression.expression.name.text !== "current"
  ) {
    return false;
  }
  const rootIdentifier = getRootIdentifier(callExpression.expression);
  const rootSymbol = rootIdentifier ? typeChecker.getSymbolAtLocation(rootIdentifier) : null;
  return Boolean(
    rootSymbol?.declarations?.some(
      (declaration) =>
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        ts.isCallExpression(declaration.initializer) &&
        getCanonicalReactApiName(declaration.initializer.expression, typeChecker) === "useRef",
    ),
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

  const executionRoots = new Set<ts.FunctionLikeDeclaration>([functionNode]);
  const collectExecutionRoots = (node: ts.Node): void => {
    if (isFunctionBoundary(node)) executionRoots.add(node);
    node.forEachChild(collectExecutionRoots);
  };
  functionNode.forEachChild(collectExecutionRoots);
  const unmodeledCallableUseLocations = new Set<string>();
  for (const executionRoot of executionRoots) {
    const reachabilityGraph = collectReachableFunctionGraph(executionRoot, context.typeChecker);
    for (const unmodeledUse of reachabilityGraph.unmodeledCallableUses) {
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
      const finalCallName = getCanonicalHookName(node, context.typeChecker);
      const isModeledContextRead =
        finalCallName === "use" &&
        Boolean(
          node.arguments[0] && isReactContextExpression(node.arguments[0], context.typeChecker),
        );
      if (finalCallName && REACT_UNMODELED_HOOK_NAMES.has(finalCallName) && !isModeledContextRead) {
        unknownEvidence.push(
          createEvidence(
            node,
            context.rootDirectory,
            `${finalCallName} does not yet have a complete lifecycle model`,
            ["render", finalCallName, "unmodeled React primitive"],
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
      if (isCallableRefInvocation(node, context.typeChecker)) {
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
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      ts.isPropertyAccessExpression(node.left) &&
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
  functionNode.forEachChild(visit);

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
