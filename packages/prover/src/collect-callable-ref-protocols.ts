import ts from "typescript";
import { collectEffectCalls } from "./collect-effect-calls.js";
import { getCanonicalReactApiName } from "./get-canonical-react-api-name.js";
import { getEffectCallback } from "./get-effect-callback.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { isNodeWithin } from "./is-node-within.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";
import { collectSymbolWrites } from "./utils/collect-symbol-writes.js";
import { getEnclosingFunction } from "./utils/get-enclosing-function.js";

export interface CallableRefProtocolDescriptor {
  declaration: ts.VariableDeclaration;
  initialValueExpression: ts.Expression;
  invocationExpressions: ReadonlyArray<ts.CallExpression>;
  isSourceComplete: boolean;
  ownerFunction: ts.FunctionLikeDeclaration;
  refName: string;
  refSymbol: ts.Symbol;
  updateExpression: ts.Expression | null;
  updateHookCall: ts.CallExpression | null;
  updateHookName: string | null;
  writeExpression: ts.BinaryExpression | null;
}

const protocolCache = new WeakMap<ts.VariableDeclaration, CallableRefProtocolDescriptor | null>();

const getRefDeclaration = (
  symbol: ts.Symbol,
  typeChecker: ts.TypeChecker,
): ts.VariableDeclaration | null => {
  for (const declaration of symbol.declarations ?? []) {
    if (
      ts.isVariableDeclaration(declaration) &&
      ts.isIdentifier(declaration.name) &&
      declaration.initializer &&
      ts.isCallExpression(declaration.initializer) &&
      getCanonicalReactApiName(declaration.initializer.expression, typeChecker) === "useRef" &&
      declaration.initializer.arguments[0]
    ) {
      return declaration;
    }
  }
  return null;
};

const getExpressionSymbol = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
): ts.Symbol | null => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (!ts.isIdentifier(unwrappedExpression)) return null;
  return typeChecker.getSymbolAtLocation(unwrappedExpression) ?? null;
};

const getRefCurrentAccess = (
  node: ts.Node,
  refSymbol: ts.Symbol,
  typeChecker: ts.TypeChecker,
): ts.PropertyAccessExpression | null => {
  if (!ts.isPropertyAccessExpression(node) || node.name.text !== "current") return null;
  const rootIdentifier = getRootIdentifier(node);
  return rootIdentifier && typeChecker.getSymbolAtLocation(rootIdentifier) === refSymbol
    ? node
    : null;
};

const hasDependencyForExpression = (
  effectCall: ts.CallExpression,
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
): boolean => {
  const dependencyExpression = effectCall.arguments[1];
  if (!dependencyExpression) return true;
  if (!ts.isArrayLiteralExpression(dependencyExpression)) return false;
  const expressionSymbol = getExpressionSymbol(expression, typeChecker);
  return Boolean(
    expressionSymbol &&
    dependencyExpression.elements.some(
      (dependency) =>
        getExpressionSymbol(unwrapTypescriptExpression(dependency), typeChecker) ===
        expressionSymbol,
    ),
  );
};

const createCallableRefProtocol = (
  declaration: ts.VariableDeclaration,
  typeChecker: ts.TypeChecker,
): CallableRefProtocolDescriptor | null => {
  if (protocolCache.has(declaration)) return protocolCache.get(declaration) ?? null;
  const ownerFunction = getEnclosingFunction(declaration);
  const refSymbol = ts.isIdentifier(declaration.name)
    ? typeChecker.getSymbolAtLocation(declaration.name)
    : null;
  const initializer =
    declaration.initializer && ts.isCallExpression(declaration.initializer)
      ? declaration.initializer
      : null;
  const initialValueExpression = initializer?.arguments[0];
  if (!ownerFunction || !refSymbol || !initializer || !initialValueExpression) {
    protocolCache.set(declaration, null);
    return null;
  }
  const writes = collectSymbolWrites(refSymbol, declaration.getSourceFile(), typeChecker).filter(
    (write) => isNodeWithin(write, ownerFunction),
  );
  const writeExpression =
    writes.length === 1 &&
    ts.isBinaryExpression(writes[0]) &&
    writes[0].operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    Boolean(getRefCurrentAccess(writes[0].left, refSymbol, typeChecker))
      ? writes[0]
      : null;
  const updateExpression = writeExpression?.right ?? null;
  const updateHookCall =
    writeExpression &&
    collectEffectCalls(ownerFunction, typeChecker).find((effectCall) => {
      const effectCallback = getEffectCallback(effectCall, typeChecker);
      return Boolean(effectCallback && isNodeWithin(writeExpression, effectCallback));
    });
  const updateHookName = updateHookCall
    ? getCanonicalReactApiName(updateHookCall.expression, typeChecker)
    : null;
  const invocationExpressions: ts.CallExpression[] = [];
  let hasUnknownUse = false;
  const currentAccesses = new Set<ts.PropertyAccessExpression>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      typeChecker.getSymbolAtLocation(node) === refSymbol &&
      node !== declaration.name
    ) {
      const currentAccess = getRefCurrentAccess(node.parent, refSymbol, typeChecker);
      if (!currentAccess) {
        hasUnknownUse = true;
      } else {
        currentAccesses.add(currentAccess);
      }
    }
    node.forEachChild(visit);
  };
  ownerFunction.forEachChild(visit);
  for (const currentAccess of currentAccesses) {
    if (writeExpression?.left === currentAccess) continue;
    if (
      ts.isCallExpression(currentAccess.parent) &&
      currentAccess.parent.expression === currentAccess
    ) {
      invocationExpressions.push(currentAccess.parent);
      continue;
    }
    hasUnknownUse = true;
  }
  const initialValueSymbol = getExpressionSymbol(initialValueExpression, typeChecker);
  const updateValueSymbol = updateExpression
    ? getExpressionSymbol(updateExpression, typeChecker)
    : null;
  const isConstDeclaration =
    ts.isVariableDeclarationList(declaration.parent) &&
    Boolean(declaration.parent.flags & ts.NodeFlags.Const);
  const isSourceComplete = Boolean(
    isConstDeclaration &&
    writes.length === 1 &&
    writeExpression &&
    updateHookCall &&
    updateExpression &&
    initialValueSymbol &&
    initialValueSymbol === updateValueSymbol &&
    hasDependencyForExpression(updateHookCall, updateExpression, typeChecker) &&
    invocationExpressions.length > 0 &&
    !hasUnknownUse,
  );
  const protocol: CallableRefProtocolDescriptor = {
    declaration,
    initialValueExpression,
    invocationExpressions,
    isSourceComplete,
    ownerFunction,
    refName: declaration.name.getText(),
    refSymbol,
    updateExpression,
    updateHookCall: updateHookCall ?? null,
    updateHookName,
    writeExpression,
  };
  protocolCache.set(declaration, protocol);
  return protocol;
};

export const getCallableRefProtocolForCurrentAccess = (
  accessExpression: ts.PropertyAccessExpression,
  typeChecker: ts.TypeChecker,
): CallableRefProtocolDescriptor | null => {
  if (accessExpression.name.text !== "current") return null;
  const rootIdentifier = getRootIdentifier(accessExpression);
  const refSymbol = rootIdentifier ? typeChecker.getSymbolAtLocation(rootIdentifier) : null;
  const declaration = refSymbol ? getRefDeclaration(refSymbol, typeChecker) : null;
  return declaration ? createCallableRefProtocol(declaration, typeChecker) : null;
};

export const getCallableRefProtocolForInitializer = (
  callExpression: ts.CallExpression,
  typeChecker: ts.TypeChecker,
): CallableRefProtocolDescriptor | null => {
  if (getCanonicalReactApiName(callExpression.expression, typeChecker) !== "useRef") return null;
  const declaration = ts.isVariableDeclaration(callExpression.parent)
    ? callExpression.parent
    : null;
  return declaration ? createCallableRefProtocol(declaration, typeChecker) : null;
};

export const collectCallableRefProtocols = (
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<CallableRefProtocolDescriptor> => {
  const protocols: CallableRefProtocolDescriptor[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== functionNode && isFunctionBoundary(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      getCanonicalReactApiName(node.initializer.expression, typeChecker) === "useRef" &&
      node.initializer.arguments[0] &&
      typeChecker.getTypeAtLocation(node.initializer.arguments[0]).getCallSignatures().length > 0
    ) {
      const protocol = createCallableRefProtocol(node, typeChecker);
      if (protocol) protocols.push(protocol);
    }
    node.forEachChild(visit);
  };
  functionNode.forEachChild(visit);
  return protocols;
};
