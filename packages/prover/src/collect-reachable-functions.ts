import ts from "typescript";
import { collectCallableTargetFunctions } from "./collect-callable-target-functions.js";
import { getCallableRefProtocolForInitializer } from "./collect-callable-ref-protocols.js";
import { SYNCHRONOUS_CALLBACK_METHOD_NAMES } from "./constants.js";
import { getCanonicalReactApiName } from "./get-canonical-react-api-name.js";
import { isIdentifierReference } from "./is-identifier-reference.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import {
  getCallableBindingsFingerprint,
  markCallableBindingsConditional,
  mergeCallableBindings,
  resolveCallableArgumentBindings,
  resolveCallableExpression,
} from "./resolve-callable-expression.js";
import { resolveFunction } from "./resolve-function.js";
import { ReactSemanticFunctionCallKind } from "./types.js";
import type { ResolvedCallableValueDescriptor } from "./resolve-callable-expression.js";

export interface ReachableFunctionDescriptor {
  functionNode: ts.FunctionLikeDeclaration;
  isConditionallyReached: boolean;
}

export interface ReachableFunctionCallDescriptor {
  callExpression: ts.CallExpression;
  sourceFunctionNode: ts.FunctionLikeDeclaration;
  targetFunctionNode: ts.FunctionLikeDeclaration;
  kind: ReactSemanticFunctionCallKind;
  sourceParameterIndex: number | null;
  callArgumentIndex: number | null;
  sourcePropertyPath: ReadonlyArray<string>;
  isConditionallyReached: boolean;
}

export interface ReachableFunctionGraphDescriptor {
  functions: ReadonlyArray<ReachableFunctionDescriptor>;
  calls: ReadonlyArray<ReachableFunctionCallDescriptor>;
  unmodeledCallableUses: ReadonlyArray<UnmodeledCallableUseDescriptor>;
}

export interface UnmodeledCallableUseDescriptor {
  functionNode: ts.FunctionLikeDeclaration;
  node: ts.Node;
  parameterIndex: number | null;
}

const isConditionallyExecuted = (
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

const getParameterSymbol = (
  functionNode: ts.FunctionLikeDeclaration,
  parameterIndex: number,
  typeChecker: ts.TypeChecker,
): ts.Symbol | null => {
  const parameter = functionNode.parameters[parameterIndex];
  return parameter && ts.isIdentifier(parameter.name)
    ? (typeChecker.getSymbolAtLocation(parameter.name) ?? null)
    : null;
};

const getNodeIdentity = (node: ts.Node): string =>
  `${node.getSourceFile().fileName}:${node.getStart()}:${node.getEnd()}`;

const getPropertyPath = (expression: ts.Expression): ReadonlyArray<string> => {
  if (!ts.isPropertyAccessExpression(expression)) return [];
  return [...getPropertyPath(expression.expression), expression.name.text];
};

const getParameterIndex = (
  functionNode: ts.FunctionLikeDeclaration,
  symbol: ts.Symbol | undefined,
  typeChecker: ts.TypeChecker,
): number => {
  if (!symbol) return -1;
  return functionNode.parameters.findIndex(
    (_, parameterIndex) => getParameterSymbol(functionNode, parameterIndex, typeChecker) === symbol,
  );
};

const getBoundCallKind = (
  sourceParameterIndex: number,
  sourcePropertyPath: ReadonlyArray<string>,
): ReactSemanticFunctionCallKind => {
  if (sourcePropertyPath.length > 0) return ReactSemanticFunctionCallKind.Property;
  if (sourceParameterIndex >= 0) return ReactSemanticFunctionCallKind.Parameter;
  return ReactSemanticFunctionCallKind.Captured;
};

const isModeledObjectArgument = (
  identifier: ts.Identifier,
  typeChecker: ts.TypeChecker,
): boolean => {
  let currentNode: ts.Node = identifier;
  while (
    ts.isShorthandPropertyAssignment(currentNode.parent) ||
    ts.isPropertyAssignment(currentNode.parent) ||
    ts.isObjectLiteralExpression(currentNode.parent)
  ) {
    currentNode = currentNode.parent;
  }
  if (!ts.isObjectLiteralExpression(currentNode)) return false;
  const parentCall = ts.isCallExpression(currentNode.parent) ? currentNode.parent : null;
  if (!parentCall || !parentCall.arguments.includes(currentNode)) return false;
  const argumentIndex = parentCall.arguments.indexOf(currentNode);
  const directTarget = resolveFunction(parentCall.expression, typeChecker);
  return Boolean(directTarget && getParameterSymbol(directTarget, argumentIndex, typeChecker));
};

const isReactDependencyArrayElement = (
  identifier: ts.Identifier,
  typeChecker: ts.TypeChecker,
): boolean => {
  let currentNode: ts.Node = identifier;
  while (currentNode.parent && !ts.isArrayLiteralExpression(currentNode.parent)) {
    if (isFunctionBoundary(currentNode.parent)) return false;
    currentNode = currentNode.parent;
  }
  const dependencyArray = ts.isArrayLiteralExpression(currentNode.parent)
    ? currentNode.parent
    : null;
  const hookCall =
    dependencyArray && ts.isCallExpression(dependencyArray.parent) ? dependencyArray.parent : null;
  return Boolean(
    hookCall &&
    hookCall.arguments[1] === dependencyArray &&
    getCanonicalReactApiName(hookCall.expression, typeChecker),
  );
};

const isModeledCallableRefInitializer = (
  identifier: ts.Identifier,
  typeChecker: ts.TypeChecker,
): boolean => {
  const callExpression = ts.isCallExpression(identifier.parent) ? identifier.parent : null;
  if (!callExpression || callExpression.arguments[0] !== identifier) return false;
  return Boolean(
    getCallableRefProtocolForInitializer(callExpression, typeChecker)?.isSourceComplete,
  );
};

const isSafeCallablePresenceCheck = (identifier: ts.Identifier): boolean => {
  const parentNode = identifier.parent;
  if (
    (ts.isPrefixUnaryExpression(parentNode) &&
      parentNode.operator === ts.SyntaxKind.ExclamationToken) ||
    (ts.isTypeOfExpression(parentNode) && parentNode.expression === identifier) ||
    (ts.isIfStatement(parentNode) && parentNode.expression === identifier) ||
    (ts.isConditionalExpression(parentNode) && parentNode.condition === identifier)
  ) {
    return true;
  }
  if (!ts.isBinaryExpression(parentNode)) return false;
  return (
    parentNode.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
    parentNode.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    parentNode.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken ||
    parentNode.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    parentNode.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    parentNode.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
    parentNode.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
  );
};

const getEnclosingCallableTransfer = (
  identifier: ts.Identifier,
  ownerFunction: ts.FunctionLikeDeclaration,
): ts.Expression | null => {
  let currentNode: ts.Node = identifier;
  while (currentNode !== ownerFunction) {
    const ownerBody = ownerFunction.body;
    if (ownerBody === currentNode && !ts.isBlock(ownerBody)) {
      return ownerBody;
    }
    const parentNode = currentNode.parent;
    if (!parentNode || isFunctionBoundary(parentNode)) return null;
    if (ts.isReturnStatement(parentNode) && parentNode.expression) return parentNode.expression;
    if (ts.isVariableDeclaration(parentNode) && parentNode.initializer) {
      return parentNode.initializer;
    }
    currentNode = parentNode;
  }
  return null;
};

export const collectReachableFunctionGraph = (
  rootFunction: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
  initialBindings: ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor> = new Map(),
): ReachableFunctionGraphDescriptor => {
  const conditionalReachability = new Map<ts.FunctionLikeDeclaration, boolean>([
    [rootFunction, false],
  ]);
  const callableBindingsByFunction = new Map<
    ts.FunctionLikeDeclaration,
    ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor>
  >([[rootFunction, initialBindings]]);
  const callDescriptors = new Map<string, ReachableFunctionCallDescriptor>();
  const unmodeledCallableUses = new Map<string, UnmodeledCallableUseDescriptor>();
  const pendingFunctions = [rootFunction];
  const pendingFunctionSet = new Set<ts.FunctionLikeDeclaration>([rootFunction]);
  const scheduleFunction = (functionNode: ts.FunctionLikeDeclaration): void => {
    if (pendingFunctionSet.has(functionNode)) return;
    pendingFunctionSet.add(functionNode);
    pendingFunctions.push(functionNode);
  };
  while (pendingFunctions.length > 0) {
    const currentFunction = pendingFunctions.shift();
    if (!currentFunction) continue;
    pendingFunctionSet.delete(currentFunction);
    const currentIsConditional = conditionalReachability.get(currentFunction) ?? true;
    const currentCallableBindings =
      callableBindingsByFunction.get(currentFunction) ??
      new Map<ts.Symbol, ResolvedCallableValueDescriptor>();
    const boundTargetFunctions = collectCallableTargetFunctions(currentCallableBindings);
    const mergeFunctionBindings = (
      targetFunction: ts.FunctionLikeDeclaration,
      incomingBindings: ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor>,
    ): void => {
      const previousBindings = callableBindingsByFunction.get(targetFunction) ?? new Map();
      const mergedBindings = mergeCallableBindings([previousBindings, incomingBindings]);
      if (
        getCallableBindingsFingerprint(previousBindings) ===
        getCallableBindingsFingerprint(mergedBindings)
      ) {
        return;
      }
      callableBindingsByFunction.set(targetFunction, mergedBindings);
      scheduleFunction(targetFunction);
    };
    const enqueueFunction = (
      targetFunction: ts.FunctionLikeDeclaration,
      targetBindings: ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor>,
      isConditionallyReached: boolean,
      callExpression: ts.CallExpression,
      kind: ReactSemanticFunctionCallKind,
      sourceParameterIndex: number | null,
      callArgumentIndex: number | null,
      sourcePropertyPath: ReadonlyArray<string>,
    ): void => {
      const callIdentity = [
        getNodeIdentity(currentFunction),
        getNodeIdentity(targetFunction),
        getNodeIdentity(callExpression),
        kind,
        sourceParameterIndex ?? "none",
        callArgumentIndex ?? "none",
        sourcePropertyPath.join("."),
      ].join(":");
      const previousCall = callDescriptors.get(callIdentity);
      if (!previousCall || (previousCall.isConditionallyReached && !isConditionallyReached)) {
        callDescriptors.set(callIdentity, {
          callExpression,
          sourceFunctionNode: currentFunction,
          targetFunctionNode: targetFunction,
          kind,
          sourceParameterIndex,
          callArgumentIndex,
          sourcePropertyPath,
          isConditionallyReached,
        });
      }
      mergeFunctionBindings(targetFunction, targetBindings);
      if (targetFunction === currentFunction || targetFunction === rootFunction) return;
      const previousReachability = conditionalReachability.get(targetFunction);
      if (previousReachability === undefined || (previousReachability && !isConditionallyReached)) {
        conditionalReachability.set(targetFunction, isConditionallyReached);
        scheduleFunction(targetFunction);
      }
    };
    const visit = (node: ts.Node): void => {
      if (node !== currentFunction && isFunctionBoundary(node)) return;
      if (ts.isIdentifier(node) && isIdentifierReference(node)) {
        const identifierSymbol = typeChecker.getSymbolAtLocation(node);
        const directlyBoundValue = identifierSymbol
          ? currentCallableBindings.get(identifierSymbol)
          : null;
        const resolvedValue =
          directlyBoundValue ??
          (boundTargetFunctions.size > 0
            ? resolveCallableExpression(node, typeChecker, currentCallableBindings)
            : null);
        const containsBoundTarget = Boolean(
          resolvedValue?.targets.some((target) => boundTargetFunctions.has(target.functionNode)),
        );
        if (
          resolvedValue &&
          resolvedValue.targets.length > 0 &&
          (directlyBoundValue || containsBoundTarget)
        ) {
          const parameterIndex = getParameterIndex(currentFunction, identifierSymbol, typeChecker);
          const parentCall = ts.isCallExpression(node.parent) ? node.parent : null;
          const isDirectInvocation = Boolean(parentCall && parentCall.expression === node);
          let isForwardedArgument = false;
          if (parentCall && parentCall.arguments.includes(node)) {
            const argumentIndex = parentCall.arguments.indexOf(node);
            const directForwardTarget = resolveFunction(parentCall.expression, typeChecker);
            isForwardedArgument = Boolean(
              (directForwardTarget &&
                getParameterSymbol(directForwardTarget, argumentIndex, typeChecker)) ||
              (ts.isPropertyAccessExpression(parentCall.expression) &&
                SYNCHRONOUS_CALLBACK_METHOD_NAMES.has(parentCall.expression.name.text)),
            );
          }
          const transferExpression = getEnclosingCallableTransfer(node, currentFunction);
          const isModeledTransfer =
            Boolean(
              transferExpression &&
              resolveCallableExpression(transferExpression, typeChecker, currentCallableBindings)
                .isComplete,
            ) ||
            isModeledObjectArgument(node, typeChecker) ||
            isReactDependencyArrayElement(node, typeChecker) ||
            isModeledCallableRefInitializer(node, typeChecker);
          if (
            !isDirectInvocation &&
            !isForwardedArgument &&
            !isModeledTransfer &&
            !isSafeCallablePresenceCheck(node)
          ) {
            unmodeledCallableUses.set(`${getNodeIdentity(node)}:${parameterIndex}`, {
              functionNode: currentFunction,
              node,
              parameterIndex: parameterIndex >= 0 ? parameterIndex : null,
            });
          }
        }
      }
      if (ts.isCallExpression(node)) {
        const callIsConditional =
          currentIsConditional || isConditionallyExecuted(node, currentFunction);
        const directTarget = resolveFunction(node.expression, typeChecker);
        if (directTarget) {
          const argumentBindings = resolveCallableArgumentBindings(
            directTarget,
            node,
            typeChecker,
            currentCallableBindings,
          );
          if (!argumentBindings.isComplete) {
            unmodeledCallableUses.set(`${getNodeIdentity(node)}:arguments`, {
              functionNode: currentFunction,
              node,
              parameterIndex: null,
            });
          }
          const targetBindings = mergeCallableBindings([
            currentCallableBindings,
            callIsConditional
              ? markCallableBindingsConditional(argumentBindings.bindings)
              : argumentBindings.bindings,
          ]);
          enqueueFunction(
            directTarget,
            targetBindings,
            callIsConditional,
            node,
            ReactSemanticFunctionCallKind.Direct,
            null,
            null,
            [],
          );
        } else {
          const callableValue = resolveCallableExpression(
            node.expression,
            typeChecker,
            currentCallableBindings,
          );
          const rootIdentifier = getRootIdentifier(node.expression);
          const rootSymbol = rootIdentifier
            ? typeChecker.getSymbolAtLocation(rootIdentifier)
            : undefined;
          const parameterIndex = getParameterIndex(currentFunction, rootSymbol, typeChecker);
          const sourcePropertyPath = getPropertyPath(node.expression);
          const callKind = getBoundCallKind(parameterIndex, sourcePropertyPath);
          for (const target of callableValue.targets) {
            enqueueFunction(
              target.functionNode,
              target.bindings,
              callIsConditional || target.isConditionallyReached,
              node,
              callKind,
              parameterIndex >= 0 ? parameterIndex : null,
              null,
              sourcePropertyPath,
            );
          }
          if (
            callableValue.targets.length === 0 &&
            rootSymbol &&
            currentCallableBindings.has(rootSymbol)
          ) {
            unmodeledCallableUses.set(`${getNodeIdentity(node)}:${parameterIndex}`, {
              functionNode: currentFunction,
              node,
              parameterIndex: parameterIndex >= 0 ? parameterIndex : null,
            });
          }
        }
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          SYNCHRONOUS_CALLBACK_METHOD_NAMES.has(node.expression.name.text)
        ) {
          for (const [argumentIndex, argument] of node.arguments.entries()) {
            const callableValue = resolveCallableExpression(
              argument,
              typeChecker,
              currentCallableBindings,
            );
            for (const callableTarget of callableValue.targets) {
              enqueueFunction(
                callableTarget.functionNode,
                callableTarget.bindings,
                true,
                node,
                ReactSemanticFunctionCallKind.SynchronousCallback,
                null,
                argumentIndex,
                [],
              );
            }
          }
        }
      }
      node.forEachChild(visit);
    };
    currentFunction.forEachChild(visit);
  }
  return {
    functions: [...conditionalReachability].map(([functionNode, isConditionallyReached]) => ({
      functionNode,
      isConditionallyReached,
    })),
    calls: [...callDescriptors.values()],
    unmodeledCallableUses: [...unmodeledCallableUses.values()],
  };
};

export const collectReachableFunctions = (
  rootFunction: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<ReachableFunctionDescriptor> =>
  collectReachableFunctionGraph(rootFunction, typeChecker).functions;
