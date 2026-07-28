import ts from "typescript";
import { collectHookBindings } from "./collect-hook-bindings.js";
import { isIdentifierReference } from "./is-identifier-reference.js";
import { isNodeWithin } from "./is-node-within.js";
import { resolveFunction } from "./resolve-function.js";
import { getResolvedSymbol } from "./utils/get-resolved-symbol.js";
import { isReactHookDependencyReference } from "./utils/is-react-hook-dependency-reference.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";
import type {
  ActionStateHookBinding,
  BoundActionStateHookBinding,
} from "./collect-hook-bindings.js";
import type { ReactAnalysisContext } from "./types.js";

export interface ActionStateDescriptor {
  binding: ActionStateHookBinding;
  reducerFunction: ts.FunctionLikeDeclaration | null;
}

export interface ActionStateDispatchDescriptor {
  binding: BoundActionStateHookBinding;
  callExpression: ts.CallExpression | null;
  evidenceNode: ts.Node;
  isActionPropReference: boolean;
}

export interface ActionStateCollection {
  dispatches: ReadonlyArray<ActionStateDispatchDescriptor>;
  states: ReadonlyArray<ActionStateDescriptor>;
}

const getActionPropAttribute = (node: ts.Node): ts.JsxAttribute | null => {
  let currentNode = node;
  while (currentNode.parent && !ts.isFunctionLike(currentNode.parent)) {
    if (ts.isJsxAttribute(currentNode.parent)) {
      const propertyName = currentNode.parent.name.getText();
      return propertyName === "action" || propertyName === "formAction" ? currentNode.parent : null;
    }
    currentNode = currentNode.parent;
  }
  return null;
};

export const collectActionState = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ActionStateCollection => {
  const bindings = collectHookBindings(functionNode, context.typeChecker).actionStateBindings;
  const boundBindings = bindings.filter((binding): binding is BoundActionStateHookBinding =>
    Boolean(binding.dispatcherSymbol),
  );
  const bindingsByDispatcher = new Map(
    boundBindings.map((binding): [ts.Symbol, BoundActionStateHookBinding] => [
      binding.dispatcherSymbol,
      binding,
    ]),
  );
  const states = bindings.map(
    (binding): ActionStateDescriptor => ({
      binding,
      reducerFunction: binding.reducerExpression
        ? resolveFunction(binding.reducerExpression, context.typeChecker)
        : null,
    }),
  );
  const handledDispatcherReferences = new Set<ts.Identifier>();
  const dispatches: ActionStateDispatchDescriptor[] = [];
  const visitCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const dispatcherSymbol = getResolvedSymbol(
        unwrapTypescriptExpression(node.expression),
        context.typeChecker,
      );
      const binding = dispatcherSymbol ? bindingsByDispatcher.get(dispatcherSymbol) : undefined;
      if (binding) {
        dispatches.push({
          binding,
          callExpression: node,
          evidenceNode: node,
          isActionPropReference: false,
        });
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

  const handledActionProps = new Set<ts.JsxAttribute>();
  const visitReferences = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      isIdentifierReference(node) &&
      !handledDispatcherReferences.has(node)
    ) {
      const dispatcherSymbol = getResolvedSymbol(node, context.typeChecker);
      const binding = dispatcherSymbol ? bindingsByDispatcher.get(dispatcherSymbol) : undefined;
      if (
        binding &&
        !isReactHookDependencyReference(node, context.typeChecker) &&
        !dispatches.some(
          (dispatch) =>
            dispatch.callExpression && isNodeWithin(node, dispatch.callExpression.expression),
        )
      ) {
        const actionPropAttribute = getActionPropAttribute(node);
        if (actionPropAttribute) {
          if (!handledActionProps.has(actionPropAttribute)) {
            handledActionProps.add(actionPropAttribute);
            dispatches.push({
              binding,
              callExpression: null,
              evidenceNode: actionPropAttribute,
              isActionPropReference: true,
            });
          }
        } else {
          dispatches.push({
            binding,
            callExpression: null,
            evidenceNode: node,
            isActionPropReference: false,
          });
        }
      }
    }
    node.forEachChild(visitReferences);
  };
  functionNode.forEachChild(visitReferences);
  return { dispatches, states };
};
