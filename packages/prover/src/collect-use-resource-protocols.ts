import ts from "typescript";
import { getCallName } from "./get-call-name.js";
import { getCanonicalReactApiName } from "./get-canonical-react-api-name.js";
import { getContainingFunction } from "./utils/get-containing-function.js";
import { getResolvedSymbol } from "./utils/get-resolved-symbol.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { isPlatformDeclarationSymbol } from "./utils/is-platform-declaration-symbol.js";
import { isReactContextExpression } from "./is-react-context-expression.js";
import { resolveFunction } from "./resolve-function.js";
import { ReactUseResourceIdentityStatus, ReactUseResourceKind } from "./types.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";

export interface UseResourceProtocolDescriptor {
  callExpression: ts.CallExpression;
  identityStatus: ReactUseResourceIdentityStatus;
  kind: ReactUseResourceKind;
}

const getVariableDeclaration = (declaration: ts.Declaration): ts.VariableDeclaration | null => {
  let currentNode: ts.Node | undefined = declaration;
  while (currentNode && !isFunctionBoundary(currentNode)) {
    if (ts.isVariableDeclaration(currentNode)) return currentNode;
    currentNode = currentNode.parent;
  }
  return null;
};

const isConstVariableDeclaration = (declaration: ts.VariableDeclaration): boolean =>
  ts.isVariableDeclarationList(declaration.parent) &&
  Boolean(declaration.parent.flags & ts.NodeFlags.Const);

const getStateInitialExpression = (
  declaration: ts.Declaration,
  typeChecker: ts.TypeChecker,
): ts.Expression | null => {
  const variableDeclaration = getVariableDeclaration(declaration);
  if (
    !variableDeclaration?.initializer ||
    !ts.isCallExpression(variableDeclaration.initializer) ||
    !ts.isArrayBindingPattern(variableDeclaration.name)
  ) {
    return null;
  }
  const stateBinding = variableDeclaration.name.elements[0];
  if (
    !stateBinding ||
    !ts.isBindingElement(stateBinding) ||
    !ts.isIdentifier(stateBinding.name) ||
    declaration !== stateBinding
  ) {
    return null;
  }
  const hookName = getCanonicalReactApiName(
    variableDeclaration.initializer.expression,
    typeChecker,
  );
  if (hookName !== "useState") return null;
  const initialValue = variableDeclaration.initializer.arguments[0];
  if (!initialValue) return null;
  const unwrappedInitialValue = unwrapTypescriptExpression(initialValue);
  if (ts.isArrowFunction(unwrappedInitialValue) || ts.isFunctionExpression(unwrappedInitialValue)) {
    return ts.isBlock(unwrappedInitialValue.body) ? null : unwrappedInitialValue.body;
  }
  return initialValue;
};

const isKnownFreshPromiseCall = (
  callExpression: ts.CallExpression,
  typeChecker: ts.TypeChecker,
): boolean => {
  const reactApiName = getCanonicalReactApiName(callExpression.expression, typeChecker);
  if (reactApiName === "useMemo") return true;
  const callName = getCallName(callExpression);
  const rootIdentifier = getRootIdentifier(callExpression.expression);
  const rootSymbol = rootIdentifier ? getResolvedSymbol(rootIdentifier, typeChecker) : null;
  if (callName === "fetch" && rootSymbol && isPlatformDeclarationSymbol(rootSymbol)) {
    return true;
  }
  if (callName?.startsWith("Promise.") && rootSymbol && isPlatformDeclarationSymbol(rootSymbol)) {
    return true;
  }
  const resolvedFunction = resolveFunction(callExpression.expression, typeChecker);
  return Boolean(
    resolvedFunction?.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword),
  );
};

const combineIdentityStatuses = (
  statuses: ReadonlyArray<ReactUseResourceIdentityStatus>,
): ReactUseResourceIdentityStatus => {
  if (statuses.length === 0 || statuses.includes(ReactUseResourceIdentityStatus.Unknown)) {
    return ReactUseResourceIdentityStatus.Unknown;
  }
  return statuses.every((status) => status === ReactUseResourceIdentityStatus.Stable)
    ? ReactUseResourceIdentityStatus.Stable
    : ReactUseResourceIdentityStatus.Unstable;
};

const getResourceIdentityStatus = (
  expression: ts.Expression,
  ownerFunction: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
  visitedSymbols: ReadonlySet<ts.Symbol> = new Set(),
): ReactUseResourceIdentityStatus => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (ts.isConditionalExpression(unwrappedExpression)) {
    return combineIdentityStatuses([
      getResourceIdentityStatus(
        unwrappedExpression.whenTrue,
        ownerFunction,
        typeChecker,
        visitedSymbols,
      ),
      getResourceIdentityStatus(
        unwrappedExpression.whenFalse,
        ownerFunction,
        typeChecker,
        visitedSymbols,
      ),
    ]);
  }
  if (ts.isCallExpression(unwrappedExpression)) {
    return isKnownFreshPromiseCall(unwrappedExpression, typeChecker)
      ? ReactUseResourceIdentityStatus.Unstable
      : ReactUseResourceIdentityStatus.Unknown;
  }
  if (ts.isNewExpression(unwrappedExpression)) {
    const constructorIdentifier = getRootIdentifier(unwrappedExpression.expression);
    const constructorSymbol = constructorIdentifier
      ? getResolvedSymbol(constructorIdentifier, typeChecker)
      : null;
    return constructorSymbol &&
      constructorIdentifier?.text === "Promise" &&
      isPlatformDeclarationSymbol(constructorSymbol)
      ? ReactUseResourceIdentityStatus.Unstable
      : ReactUseResourceIdentityStatus.Unknown;
  }
  if (!ts.isIdentifier(unwrappedExpression)) {
    return ReactUseResourceIdentityStatus.Unknown;
  }
  const symbol = getResolvedSymbol(unwrappedExpression, typeChecker);
  if (!symbol || visitedSymbols.has(symbol)) return ReactUseResourceIdentityStatus.Unknown;
  const nextVisitedSymbols = new Set(visitedSymbols).add(symbol);
  for (const declaration of symbol.declarations ?? []) {
    const stateInitialExpression = getStateInitialExpression(declaration, typeChecker);
    if (stateInitialExpression) {
      return getResourceIdentityStatus(
        stateInitialExpression,
        ownerFunction,
        typeChecker,
        nextVisitedSymbols,
      );
    }
    const variableDeclaration = getVariableDeclaration(declaration);
    if (
      !variableDeclaration ||
      !isConstVariableDeclaration(variableDeclaration) ||
      !variableDeclaration.initializer
    ) {
      continue;
    }
    if (!getContainingFunction(variableDeclaration)) {
      return ReactUseResourceIdentityStatus.Stable;
    }
    if (getContainingFunction(variableDeclaration) === ownerFunction) {
      return getResourceIdentityStatus(
        variableDeclaration.initializer,
        ownerFunction,
        typeChecker,
        nextVisitedSymbols,
      );
    }
  }
  return ReactUseResourceIdentityStatus.Unknown;
};

const getTypeKind = (
  valueType: ts.Type,
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
): ReactUseResourceKind => {
  if (valueType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
    return ReactUseResourceKind.Unknown;
  }
  if (valueType.isUnion()) {
    const memberKinds = valueType.types.map((memberType) =>
      getTypeKind(memberType, expression, typeChecker),
    );
    if (memberKinds.every((kind) => kind === ReactUseResourceKind.Thenable)) {
      return ReactUseResourceKind.Thenable;
    }
    if (memberKinds.every((kind) => kind === ReactUseResourceKind.Invalid)) {
      return ReactUseResourceKind.Invalid;
    }
    return ReactUseResourceKind.Unknown;
  }
  if (valueType.flags & ts.TypeFlags.TypeParameter) {
    const constraint = typeChecker.getBaseConstraintOfType(valueType);
    return constraint
      ? getTypeKind(constraint, expression, typeChecker)
      : ReactUseResourceKind.Unknown;
  }
  const thenProperty = typeChecker.getPropertyOfType(valueType, "then");
  if (!thenProperty) return ReactUseResourceKind.Invalid;
  const thenType = typeChecker.getTypeOfSymbolAtLocation(thenProperty, expression);
  return thenType.getCallSignatures().length > 0
    ? ReactUseResourceKind.Thenable
    : ReactUseResourceKind.Invalid;
};

export const collectUseResourceProtocols = (
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<UseResourceProtocolDescriptor> => {
  const protocols: UseResourceProtocolDescriptor[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== functionNode && isFunctionBoundary(node)) return;
    if (
      ts.isCallExpression(node) &&
      getCanonicalReactApiName(node.expression, typeChecker) === "use"
    ) {
      const resourceExpression = node.arguments[0];
      if (resourceExpression && isReactContextExpression(resourceExpression, typeChecker)) {
        return;
      }
      protocols.push({
        callExpression: node,
        identityStatus: resourceExpression
          ? getResourceIdentityStatus(resourceExpression, functionNode, typeChecker)
          : ReactUseResourceIdentityStatus.Unknown,
        kind: resourceExpression
          ? getTypeKind(
              typeChecker.getTypeAtLocation(resourceExpression),
              resourceExpression,
              typeChecker,
            )
          : ReactUseResourceKind.Invalid,
      });
      return;
    }
    node.forEachChild(visit);
  };
  functionNode.forEachChild(visit);
  return protocols;
};
