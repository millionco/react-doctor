import ts from "typescript";
import { collectHookBindings } from "./collect-hook-bindings.js";
import { REACT_TRANSITION_ACTION_INDEX } from "./constants.js";
import { getCanonicalReactApiName } from "./get-canonical-react-api-name.js";
import { isIdentifierReference } from "./is-identifier-reference.js";
import { isNodeWithin } from "./is-node-within.js";
import { resolveFunction } from "./resolve-function.js";
import { ReactTransitionActionStatus, ReactTransitionStarterKind, ReactUnitKind } from "./types.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";
import type { ReactAnalysisContext, ReactUnitDescriptor } from "./types.js";
import { collectReachableCallExpressions } from "./utils/collect-reachable-call-expressions.js";
import { getResolvedSymbol } from "./utils/get-resolved-symbol.js";
import { isDeferredCallbackSynchronous } from "./utils/is-deferred-callback-synchronous.js";
import { isIntrinsicJsxElement } from "./utils/is-intrinsic-jsx-element.js";
import { isReactHookDependencyReference } from "./utils/is-react-hook-dependency-reference.js";

export interface TransitionActionDescriptor {
  actionFunction: ts.FunctionLikeDeclaration | null;
  callExpression: ts.CallExpression | null;
  controlledStateNames: ReadonlyArray<string>;
  evidenceNode: ts.Node;
  starterKind: ReactTransitionStarterKind;
  status: ReactTransitionActionStatus;
  unknownControlStateNames: ReadonlyArray<string>;
}

interface StateControlFacts {
  controlledStateSymbols: ReadonlySet<ts.Symbol>;
  unknownControlStateSymbols: ReadonlySet<ts.Symbol>;
}

const getTransitionRoots = (
  unit: ReactUnitDescriptor,
): ReadonlyArray<ts.FunctionLikeDeclaration> => {
  if (unit.kind === ReactUnitKind.ClassComponent && unit.classNode) {
    return unit.classNode.members.filter(ts.isMethodDeclaration);
  }
  return unit.functionNode ? [unit.functionNode] : [];
};

const collectStateOriginsBySymbol = (
  functionNode: ts.FunctionLikeDeclaration,
  stateSymbols: ReadonlySet<ts.Symbol>,
  typeChecker: ts.TypeChecker,
): ReadonlyMap<ts.Symbol, ReadonlySet<ts.Symbol>> => {
  const stateOriginsBySymbol = new Map<ts.Symbol, Set<ts.Symbol>>(
    [...stateSymbols].map((stateSymbol) => [stateSymbol, new Set([stateSymbol])]),
  );
  const declarations: ts.VariableDeclaration[] = [];
  const visitDeclarations = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      declarations.push(node);
    }
    node.forEachChild(visitDeclarations);
  };
  functionNode.forEachChild(visitDeclarations);
  const collectOrigins = (node: ts.Node): ReadonlySet<ts.Symbol> => {
    const origins = new Set<ts.Symbol>();
    const visit = (currentNode: ts.Node): void => {
      if (ts.isIdentifier(currentNode) && isIdentifierReference(currentNode)) {
        const symbol = getResolvedSymbol(currentNode, typeChecker);
        for (const origin of (symbol && stateOriginsBySymbol.get(symbol)) ?? []) {
          origins.add(origin);
        }
      }
      currentNode.forEachChild(visit);
    };
    visit(node);
    return origins;
  };
  let didAddOrigin = true;
  while (didAddOrigin) {
    didAddOrigin = false;
    for (const declaration of declarations) {
      const symbol = getResolvedSymbol(declaration.name, typeChecker);
      if (!symbol || !declaration.initializer) continue;
      const origins = collectOrigins(declaration.initializer);
      if (origins.size === 0) continue;
      const existingOrigins = stateOriginsBySymbol.get(symbol) ?? new Set<ts.Symbol>();
      const previousSize = existingOrigins.size;
      for (const origin of origins) existingOrigins.add(origin);
      stateOriginsBySymbol.set(symbol, existingOrigins);
      if (existingOrigins.size !== previousSize) didAddOrigin = true;
    }
  }
  return stateOriginsBySymbol;
};

const collectStateOrigins = (
  node: ts.Node,
  stateOriginsBySymbol: ReadonlyMap<ts.Symbol, ReadonlySet<ts.Symbol>>,
  typeChecker: ts.TypeChecker,
): ReadonlySet<ts.Symbol> => {
  const origins = new Set<ts.Symbol>();
  const visit = (currentNode: ts.Node): void => {
    if (ts.isIdentifier(currentNode) && isIdentifierReference(currentNode)) {
      const symbol = getResolvedSymbol(currentNode, typeChecker);
      for (const origin of (symbol && stateOriginsBySymbol.get(symbol)) ?? []) {
        origins.add(origin);
      }
    }
    currentNode.forEachChild(visit);
  };
  visit(node);
  return origins;
};

const collectStateControlFacts = (
  functionNode: ts.FunctionLikeDeclaration,
  stateSymbols: ReadonlySet<ts.Symbol>,
  typeChecker: ts.TypeChecker,
  unitKind: ReactUnitKind,
): StateControlFacts => {
  const stateOriginsBySymbol = collectStateOriginsBySymbol(functionNode, stateSymbols, typeChecker);
  const controlledStateSymbols = new Set<ts.Symbol>();
  const unknownControlStateSymbols = new Set<ts.Symbol>();
  const addOrigins = (target: Set<ts.Symbol>, node: ts.Node): void => {
    for (const origin of collectStateOrigins(node, stateOriginsBySymbol, typeChecker)) {
      target.add(origin);
    }
  };
  const visit = (node: ts.Node): void => {
    let openingElement: ts.JsxOpeningLikeElement | null = null;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      openingElement = node;
    }
    if (openingElement) {
      const isIntrinsic = isIntrinsicJsxElement(openingElement);
      const isFormControl =
        isIntrinsic &&
        ts.isIdentifier(openingElement.tagName) &&
        (openingElement.tagName.text === "input" ||
          openingElement.tagName.text === "select" ||
          openingElement.tagName.text === "textarea");
      for (const property of openingElement.attributes.properties) {
        if (ts.isJsxSpreadAttribute(property)) {
          if (isFormControl || !isIntrinsic) {
            addOrigins(unknownControlStateSymbols, property.expression);
          }
          continue;
        }
        const initializer = property.initializer;
        const expression =
          initializer && ts.isJsxExpression(initializer) ? initializer.expression : null;
        if (!expression) continue;
        if (
          isFormControl &&
          (property.name.getText() === "value" || property.name.getText() === "checked")
        ) {
          addOrigins(controlledStateSymbols, expression);
        } else if (!isIntrinsic) {
          addOrigins(unknownControlStateSymbols, expression);
        }
      }
    }
    if (unitKind === ReactUnitKind.Hook && ts.isReturnStatement(node) && node.expression) {
      addOrigins(unknownControlStateSymbols, node.expression);
    }
    node.forEachChild(visit);
  };
  functionNode.forEachChild(visit);
  return { controlledStateSymbols, unknownControlStateSymbols };
};

const getStarterKind = (
  callExpression: ts.CallExpression,
  transitionStarters: ReadonlySet<ts.Symbol>,
  typeChecker: ts.TypeChecker,
): ReactTransitionStarterKind | null => {
  const unwrappedCallee = unwrapTypescriptExpression(callExpression.expression);
  if (getCanonicalReactApiName(unwrappedCallee, typeChecker) === "startTransition") {
    return ReactTransitionStarterKind.Global;
  }
  const calleeSymbol = getResolvedSymbol(unwrappedCallee, typeChecker);
  return calleeSymbol && transitionStarters.has(calleeSymbol)
    ? ReactTransitionStarterKind.Hook
    : null;
};

export const collectTransitionActions = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReadonlyArray<TransitionActionDescriptor> => {
  const functionNode = unit.functionNode;
  const hookBindings = functionNode ? collectHookBindings(functionNode, context.typeChecker) : null;
  const transitionStarters = hookBindings?.transitionStarters ?? new Set<ts.Symbol>();
  const stateValueBySetter = hookBindings?.stateValueBySetter ?? new Map<ts.Symbol, ts.Symbol>();
  const stateControlFacts = functionNode
    ? collectStateControlFacts(
        functionNode,
        new Set(stateValueBySetter.values()),
        context.typeChecker,
        unit.kind,
      )
    : {
        controlledStateSymbols: new Set<ts.Symbol>(),
        unknownControlStateSymbols: new Set<ts.Symbol>(),
      };
  const handledStarterReferences = new Set<ts.Identifier>();
  const actions: TransitionActionDescriptor[] = [];
  const roots = getTransitionRoots(unit);
  const visitCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const starterKind = getStarterKind(node, transitionStarters, context.typeChecker);
      if (starterKind) {
        const actionExpression = node.arguments[REACT_TRANSITION_ACTION_INDEX];
        const actionFunction = actionExpression
          ? resolveFunction(actionExpression, context.typeChecker)
          : null;
        let status = ReactTransitionActionStatus.Opaque;
        let controlledStateNames: ReadonlyArray<string> = [];
        let unknownControlStateNames: ReadonlyArray<string> = [];
        if (actionFunction) {
          if (!isDeferredCallbackSynchronous(actionFunction, context)) {
            status = ReactTransitionActionStatus.Async;
          } else {
            const updatedStateSymbols = new Set<ts.Symbol>();
            for (const callExpression of collectReachableCallExpressions(
              actionFunction,
              context.typeChecker,
            )) {
              const calleeSymbol = getResolvedSymbol(
                unwrapTypescriptExpression(callExpression.expression),
                context.typeChecker,
              );
              const stateSymbol = calleeSymbol ? stateValueBySetter.get(calleeSymbol) : undefined;
              if (stateSymbol) updatedStateSymbols.add(stateSymbol);
            }
            const controlledStateNameList: string[] = [];
            const unknownControlStateNameList: string[] = [];
            for (const stateSymbol of updatedStateSymbols) {
              if (stateControlFacts.controlledStateSymbols.has(stateSymbol)) {
                controlledStateNameList.push(stateSymbol.getName());
              } else if (stateControlFacts.unknownControlStateSymbols.has(stateSymbol)) {
                unknownControlStateNameList.push(stateSymbol.getName());
              }
            }
            controlledStateNames = controlledStateNameList.sort();
            unknownControlStateNames = unknownControlStateNameList.sort();
            status = ReactTransitionActionStatus.Synchronous;
            if (unknownControlStateNames.length > 0) {
              status = ReactTransitionActionStatus.UnknownControl;
            }
            if (controlledStateNames.length > 0) {
              status = ReactTransitionActionStatus.ControlledInput;
            }
          }
        }
        actions.push({
          actionFunction,
          callExpression: node,
          controlledStateNames,
          evidenceNode: node,
          starterKind,
          status,
          unknownControlStateNames,
        });
        const collectHandledReferences = (calleeNode: ts.Node): void => {
          if (ts.isIdentifier(calleeNode)) handledStarterReferences.add(calleeNode);
          calleeNode.forEachChild(collectHandledReferences);
        };
        collectHandledReferences(node.expression);
      }
    }
    node.forEachChild(visitCalls);
  };
  for (const root of roots) root.forEachChild(visitCalls);

  const visitEscapes = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      isIdentifierReference(node) &&
      !handledStarterReferences.has(node) &&
      !isReactHookDependencyReference(node, context.typeChecker)
    ) {
      const symbol = getResolvedSymbol(node, context.typeChecker);
      let starterKind: ReactTransitionStarterKind | null = null;
      if (symbol && transitionStarters.has(symbol)) {
        starterKind = ReactTransitionStarterKind.Hook;
      } else if (getCanonicalReactApiName(node, context.typeChecker) === "startTransition") {
        starterKind = ReactTransitionStarterKind.Global;
      }
      if (
        starterKind &&
        !actions.some(
          (action) => action.callExpression && isNodeWithin(node, action.callExpression.expression),
        )
      ) {
        actions.push({
          actionFunction: null,
          callExpression: null,
          controlledStateNames: [],
          evidenceNode: node,
          starterKind,
          status: ReactTransitionActionStatus.StarterEscape,
          unknownControlStateNames: [],
        });
      }
    }
    node.forEachChild(visitEscapes);
  };
  for (const root of roots) root.forEachChild(visitEscapes);
  return actions;
};
