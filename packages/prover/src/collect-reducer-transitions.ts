import ts from "typescript";
import {
  REACT_REDUCER_DISPATCHER_INDEX,
  REACT_REDUCER_HOOK_NAMES,
  REACT_REDUCER_INITIALIZER_INDEX,
  REACT_REDUCER_REDUCER_INDEX,
  REACT_REDUCER_STATE_INDEX,
  REACT_REDUCER_TUPLE_LENGTH,
} from "./constants.js";
import { collectHookCalls } from "./collect-hook-calls.js";
import { isIdentifierReference } from "./is-identifier-reference.js";
import { isNodeWithin } from "./is-node-within.js";
import { resolveFunction } from "./resolve-function.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";
import { getResolvedSymbol } from "./utils/get-resolved-symbol.js";
import { isReactHookDependencyReference } from "./utils/is-react-hook-dependency-reference.js";
import type { ReactAnalysisContext } from "./types.js";

export interface ReducerBindingDescriptor {
  callExpression: ts.CallExpression;
  dispatcherSymbol: ts.Symbol | null;
  initializerFunction: ts.FunctionLikeDeclaration | null;
  initializerProvided: boolean;
  reducerFunction: ts.FunctionLikeDeclaration | null;
  stateSymbol: ts.Symbol | null;
}

export interface BoundReducerBindingDescriptor extends ReducerBindingDescriptor {
  dispatcherSymbol: ts.Symbol;
}

export interface ReducerDispatchDescriptor {
  binding: BoundReducerBindingDescriptor;
  callExpression: ts.CallExpression | null;
  evidenceNode: ts.Node;
}

export interface ReducerTransitionCollection {
  dispatches: ReadonlyArray<ReducerDispatchDescriptor>;
  reducers: ReadonlyArray<ReducerBindingDescriptor>;
}

const getBindingSymbol = (
  bindingElement: ts.ArrayBindingElement | undefined,
  typeChecker: ts.TypeChecker,
): ts.Symbol | null => {
  if (
    !bindingElement ||
    !ts.isBindingElement(bindingElement) ||
    bindingElement.dotDotDotToken ||
    !ts.isIdentifier(bindingElement.name)
  ) {
    return null;
  }
  return typeChecker.getSymbolAtLocation(bindingElement.name) ?? null;
};

const getVariableDeclaration = (
  callExpression: ts.CallExpression,
): ts.VariableDeclaration | null => {
  let currentNode: ts.Node = callExpression;
  while (
    currentNode.parent &&
    ts.isExpression(currentNode.parent) &&
    unwrapTypescriptExpression(currentNode.parent) === callExpression
  ) {
    currentNode = currentNode.parent;
  }
  return currentNode.parent &&
    ts.isVariableDeclaration(currentNode.parent) &&
    currentNode.parent.initializer === currentNode
    ? currentNode.parent
    : null;
};

export const collectReducerTransitions = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReducerTransitionCollection => {
  const reducers = collectHookCalls(
    functionNode,
    REACT_REDUCER_HOOK_NAMES,
    context.typeChecker,
  ).map((callExpression): ReducerBindingDescriptor => {
    const declaration = getVariableDeclaration(callExpression);
    const bindingPattern =
      declaration?.name &&
      ts.isArrayBindingPattern(declaration.name) &&
      declaration.name.elements.length <= REACT_REDUCER_TUPLE_LENGTH
        ? declaration.name
        : null;
    const reducerExpression = callExpression.arguments[REACT_REDUCER_REDUCER_INDEX];
    const initializerExpression = callExpression.arguments[REACT_REDUCER_INITIALIZER_INDEX];
    return {
      callExpression,
      dispatcherSymbol: getBindingSymbol(
        bindingPattern?.elements[REACT_REDUCER_DISPATCHER_INDEX],
        context.typeChecker,
      ),
      initializerFunction: initializerExpression
        ? resolveFunction(initializerExpression, context.typeChecker)
        : null,
      initializerProvided: Boolean(initializerExpression),
      reducerFunction: reducerExpression
        ? resolveFunction(reducerExpression, context.typeChecker)
        : null,
      stateSymbol: getBindingSymbol(
        bindingPattern?.elements[REACT_REDUCER_STATE_INDEX],
        context.typeChecker,
      ),
    };
  });
  const boundReducers = reducers.filter((binding): binding is BoundReducerBindingDescriptor =>
    Boolean(binding.dispatcherSymbol),
  );
  const reducersByDispatcher = new Map(
    boundReducers.map((binding): [ts.Symbol, BoundReducerBindingDescriptor] => [
      binding.dispatcherSymbol,
      binding,
    ]),
  );
  const handledDispatcherReferences = new Set<ts.Identifier>();
  const dispatches: ReducerDispatchDescriptor[] = [];
  const visitCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const dispatcherSymbol = getResolvedSymbol(
        unwrapTypescriptExpression(node.expression),
        context.typeChecker,
      );
      const binding = dispatcherSymbol ? reducersByDispatcher.get(dispatcherSymbol) : undefined;
      if (binding) {
        dispatches.push({ binding, callExpression: node, evidenceNode: node });
        const collectHandledReferences = (calleeNode: ts.Node): void => {
          if (
            ts.isIdentifier(calleeNode) &&
            getResolvedSymbol(calleeNode, context.typeChecker) === dispatcherSymbol
          ) {
            handledDispatcherReferences.add(calleeNode);
          }
          calleeNode.forEachChild(collectHandledReferences);
        };
        collectHandledReferences(node.expression);
      }
    }
    node.forEachChild(visitCalls);
  };
  functionNode.forEachChild(visitCalls);

  const visitEscapes = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      isIdentifierReference(node) &&
      !handledDispatcherReferences.has(node)
    ) {
      const dispatcherSymbol = getResolvedSymbol(node, context.typeChecker);
      const binding = dispatcherSymbol ? reducersByDispatcher.get(dispatcherSymbol) : undefined;
      if (
        binding &&
        !isReactHookDependencyReference(node, context.typeChecker) &&
        !dispatches.some(
          (dispatch) =>
            dispatch.callExpression && isNodeWithin(node, dispatch.callExpression.expression),
        )
      ) {
        dispatches.push({ binding, callExpression: null, evidenceNode: node });
      }
    }
    node.forEachChild(visitEscapes);
  };
  functionNode.forEachChild(visitEscapes);
  return { dispatches, reducers };
};
