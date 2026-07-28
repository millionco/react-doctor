import ts from "typescript";
import { getCanonicalReactApiName } from "./get-canonical-react-api-name.js";
import { getForOfBindingDescriptor } from "./get-for-of-binding-descriptor.js";
import { resolveFunction } from "./resolve-function.js";
import { summarizeFunctionReturns } from "./summarize-function-returns.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";
import { collectSymbolWrites } from "./utils/collect-symbol-writes.js";

export interface ResolvedCallableTargetDescriptor {
  bindings: ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor>;
  functionNode: ts.FunctionLikeDeclaration;
  guards: ReadonlyArray<ResolvedCallableGuardDescriptor>;
  isConditionallyReached: boolean;
}

export interface ResolvedCallableGuardDescriptor {
  conditionIdentity: string;
  conditionNode: ts.Node;
  isSubstituted: boolean;
  polarity: boolean;
}

export interface ResolvedCallableValueDescriptor {
  isComplete: boolean;
  properties: ReadonlyMap<string, ResolvedCallableValueDescriptor>;
  targets: ReadonlyArray<ResolvedCallableTargetDescriptor>;
}

export interface CallableArgumentBindingsDescriptor {
  bindings: ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor>;
  guardBindings: ReadonlyMap<ts.Symbol, ResolvedCallableGuardDescriptor>;
  isComplete: boolean;
}

interface CallableResolutionState {
  guardBindings: ReadonlyMap<ts.Symbol, ResolvedCallableGuardDescriptor>;
  resolvingFunctions: ReadonlySet<ts.FunctionLikeDeclaration>;
  resolvingSymbols: ReadonlySet<ts.Symbol>;
}

const symbolWriteCache = new WeakMap<ts.Symbol, boolean>();

const createEmptyCallableValue = (isComplete: boolean): ResolvedCallableValueDescriptor => ({
  isComplete,
  properties: new Map(),
  targets: [],
});

const getNodeIdentity = (node: ts.Node): string =>
  `${node.getSourceFile().fileName}:${node.getStart()}:${node.getEnd()}`;

const getSymbolIdentity = (symbol: ts.Symbol): string => {
  const declaration = symbol.declarations?.[0];
  return declaration ? getNodeIdentity(declaration) : symbol.getName();
};

const getCallableGuardFingerprint = (
  guards: ReadonlyArray<ResolvedCallableGuardDescriptor>,
): string =>
  guards
    .map(
      (guard) =>
        `${guard.conditionIdentity}=${String(guard.polarity)}:${String(guard.isSubstituted)}`,
    )
    .sort()
    .join("&");

const getCallableBindingsFingerprintWithVisited = (
  bindings: ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor>,
  visitedValues: Set<ResolvedCallableValueDescriptor>,
): string =>
  [...bindings]
    .map(
      ([symbol, value]) =>
        `${getSymbolIdentity(symbol)}=${getCallableValueFingerprintWithVisited(value, visitedValues)}`,
    )
    .sort()
    .join(",");

const getCallableValueFingerprintWithVisited = (
  value: ResolvedCallableValueDescriptor,
  visitedValues: Set<ResolvedCallableValueDescriptor>,
): string => {
  if (visitedValues.has(value)) return "recursive";
  visitedValues.add(value);
  const properties = [...value.properties]
    .map(
      ([propertyName, propertyValue]) =>
        `${propertyName}:${getCallableValueFingerprintWithVisited(propertyValue, visitedValues)}`,
    )
    .sort()
    .join(",");
  const targets = value.targets
    .map(
      (target) =>
        `${getNodeIdentity(target.functionNode)}:${String(target.isConditionallyReached)}:${getCallableGuardFingerprint(target.guards)}:{${getCallableBindingsFingerprintWithVisited(target.bindings, visitedValues)}}`,
    )
    .sort()
    .join(",");
  visitedValues.delete(value);
  return `${String(value.isComplete)}:[${targets}]:{${properties}}`;
};

export const getCallableBindingsFingerprint = (
  bindings: ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor>,
): string => getCallableBindingsFingerprintWithVisited(bindings, new Set());

export const mergeCallableValues = (
  values: ReadonlyArray<ResolvedCallableValueDescriptor>,
): ResolvedCallableValueDescriptor => {
  if (values.length === 0) return createEmptyCallableValue(false);
  const propertyNames = new Set(values.flatMap((value) => [...value.properties.keys()]));
  const properties = new Map<string, ResolvedCallableValueDescriptor>();
  for (const propertyName of propertyNames) {
    properties.set(
      propertyName,
      mergeCallableValues(
        values.map(
          (value) => value.properties.get(propertyName) ?? createEmptyCallableValue(false),
        ),
      ),
    );
  }
  const targetsByFingerprint = new Map<string, ResolvedCallableTargetDescriptor>();
  for (const target of values.flatMap((value) => value.targets)) {
    const guardFingerprint = getCallableGuardFingerprint(target.guards);
    const targetFingerprint = `${getNodeIdentity(target.functionNode)}:${String(target.isConditionallyReached)}:${guardFingerprint}:${getCallableBindingsFingerprint(target.bindings)}`;
    targetsByFingerprint.set(targetFingerprint, target);
  }
  return {
    isComplete: values.every((value) => value.isComplete),
    properties,
    targets: [...targetsByFingerprint.values()],
  };
};

export const mergeCallableBindings = (
  bindings: ReadonlyArray<ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor>>,
): ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor> => {
  const valuesBySymbol = new Map<ts.Symbol, ResolvedCallableValueDescriptor[]>();
  for (const binding of bindings) {
    for (const [symbol, value] of binding) {
      const symbolValues = valuesBySymbol.get(symbol) ?? [];
      symbolValues.push(value);
      valuesBySymbol.set(symbol, symbolValues);
    }
  }
  return new Map(
    [...valuesBySymbol].map(([symbol, values]) => [symbol, mergeCallableValues(values)]),
  );
};

export const markCallableValueConditional = (
  value: ResolvedCallableValueDescriptor,
): ResolvedCallableValueDescriptor => ({
  ...value,
  properties: new Map(
    [...value.properties].map(([propertyName, propertyValue]) => [
      propertyName,
      markCallableValueConditional(propertyValue),
    ]),
  ),
  targets: value.targets.map((target) => ({
    ...target,
    isConditionallyReached: true,
  })),
});

export const markCallableBindingsConditional = (
  bindings: ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor>,
): ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor> =>
  new Map([...bindings].map(([symbol, value]) => [symbol, markCallableValueConditional(value)]));

const addCallableValueGuard = (
  value: ResolvedCallableValueDescriptor,
  guard: ResolvedCallableGuardDescriptor,
): ResolvedCallableValueDescriptor => ({
  ...value,
  properties: new Map(
    [...value.properties].map(([propertyName, propertyValue]) => [
      propertyName,
      addCallableValueGuard(propertyValue, guard),
    ]),
  ),
  targets: value.targets.flatMap((target): ReadonlyArray<ResolvedCallableTargetDescriptor> => {
    const existingGuard = target.guards.find(
      (targetGuard) => targetGuard.conditionIdentity === guard.conditionIdentity,
    );
    if (existingGuard && existingGuard.polarity !== guard.polarity) return [];
    const guards = existingGuard
      ? target.guards.map((targetGuard) =>
          targetGuard === existingGuard
            ? {
                ...targetGuard,
                isSubstituted: targetGuard.isSubstituted || guard.isSubstituted,
              }
            : targetGuard,
        )
      : [...target.guards, guard];
    return [
      {
        ...target,
        guards,
      },
    ];
  }),
});

const removeUnsubstitutedCallableValueGuards = (
  value: ResolvedCallableValueDescriptor,
): ResolvedCallableValueDescriptor => ({
  ...value,
  properties: new Map(
    [...value.properties].map(([propertyName, propertyValue]) => [
      propertyName,
      removeUnsubstitutedCallableValueGuards(propertyValue),
    ]),
  ),
  targets: value.targets.map((target) => ({
    ...target,
    guards: target.guards.filter((guard) => guard.isSubstituted),
  })),
});

const getCallableGuard = (
  condition: ts.Expression,
  polarity: boolean,
  typeChecker: ts.TypeChecker,
  state: CallableResolutionState,
): ResolvedCallableGuardDescriptor | null => {
  let unwrappedCondition = unwrapTypescriptExpression(condition);
  let resolvedPolarity = polarity;
  while (
    ts.isPrefixUnaryExpression(unwrappedCondition) &&
    unwrappedCondition.operator === ts.SyntaxKind.ExclamationToken
  ) {
    resolvedPolarity = !resolvedPolarity;
    unwrappedCondition = unwrapTypescriptExpression(unwrappedCondition.operand);
  }
  if (!ts.isIdentifier(unwrappedCondition)) return null;
  const conditionSymbol = typeChecker.getSymbolAtLocation(unwrappedCondition);
  const conditionDeclaration = conditionSymbol?.declarations?.[0];
  if (!conditionSymbol || !conditionDeclaration) return null;
  const hasConditionWrites =
    symbolWriteCache.get(conditionSymbol) ??
    collectSymbolWrites(conditionSymbol, conditionDeclaration.getSourceFile(), typeChecker).length >
      0;
  symbolWriteCache.set(conditionSymbol, hasConditionWrites);
  if (hasConditionWrites) return null;
  const guardBinding = state.guardBindings.get(conditionSymbol);
  if (guardBinding) {
    return {
      ...guardBinding,
      isSubstituted: true,
      polarity: resolvedPolarity === guardBinding.polarity,
    };
  }
  const resolvedConditionSymbol =
    conditionSymbol.flags & ts.SymbolFlags.Alias
      ? typeChecker.getAliasedSymbol(conditionSymbol)
      : conditionSymbol;
  const resolvedConditionDeclaration = resolvedConditionSymbol.declarations?.[0];
  if (!resolvedConditionDeclaration) return null;
  const hasResolvedConditionWrites =
    symbolWriteCache.get(resolvedConditionSymbol) ??
    collectSymbolWrites(
      resolvedConditionSymbol,
      resolvedConditionDeclaration.getSourceFile(),
      typeChecker,
    ).length > 0;
  symbolWriteCache.set(resolvedConditionSymbol, hasResolvedConditionWrites);
  if (hasResolvedConditionWrites) return null;
  return {
    conditionIdentity: getSymbolIdentity(resolvedConditionSymbol),
    conditionNode: resolvedConditionDeclaration,
    isSubstituted: false,
    polarity: resolvedPolarity,
  };
};

const getObjectPropertyName = (name: ts.PropertyName): string | null => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
};

const doesTypeContainCallableWithVisited = (
  type: ts.Type,
  typeChecker: ts.TypeChecker,
  visitedTypes: Set<ts.Type>,
): boolean => {
  if (visitedTypes.has(type)) return false;
  visitedTypes.add(type);
  if (type.getCallSignatures().length > 0) return true;
  if (type.isUnionOrIntersection()) {
    return type.types.some((memberType) =>
      doesTypeContainCallableWithVisited(memberType, typeChecker, visitedTypes),
    );
  }
  if (!(type.flags & ts.TypeFlags.Object)) return false;
  return type.getProperties().some((propertySymbol) => {
    const declaration = propertySymbol.valueDeclaration ?? propertySymbol.declarations?.[0];
    if (
      !declaration ||
      (!ts.isPropertySignature(declaration) &&
        !ts.isPropertyDeclaration(declaration) &&
        !ts.isPropertyAssignment(declaration) &&
        !ts.isShorthandPropertyAssignment(declaration))
    ) {
      return false;
    }
    return Boolean(
      doesTypeContainCallableWithVisited(
        typeChecker.getTypeOfSymbolAtLocation(propertySymbol, declaration),
        typeChecker,
        visitedTypes,
      ),
    );
  });
};

export const doesTypeContainCallable = (type: ts.Type, typeChecker: ts.TypeChecker): boolean =>
  doesTypeContainCallableWithVisited(type, typeChecker, new Set());

const parameterNeedsCallableBinding = (
  parameter: ts.ParameterDeclaration,
  typeChecker: ts.TypeChecker,
): boolean => doesTypeContainCallable(typeChecker.getTypeAtLocation(parameter), typeChecker);

const resolveObjectLiteral = (
  objectLiteral: ts.ObjectLiteralExpression,
  typeChecker: ts.TypeChecker,
  bindings: ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor>,
  state: CallableResolutionState,
): ResolvedCallableValueDescriptor => {
  const properties = new Map<string, ResolvedCallableValueDescriptor>();
  let isComplete = true;
  for (const property of objectLiteral.properties) {
    if (ts.isSpreadAssignment(property)) {
      isComplete = false;
      continue;
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      properties.set(
        property.name.text,
        resolveCallableExpressionWithState(property.name, typeChecker, bindings, state),
      );
      continue;
    }
    if (ts.isPropertyAssignment(property)) {
      const propertyName = getObjectPropertyName(property.name);
      if (!propertyName) {
        isComplete = false;
        continue;
      }
      properties.set(
        propertyName,
        resolveCallableExpressionWithState(property.initializer, typeChecker, bindings, state),
      );
      continue;
    }
    if (ts.isMethodDeclaration(property)) {
      const propertyName = getObjectPropertyName(property.name);
      if (!propertyName) {
        isComplete = false;
        continue;
      }
      properties.set(propertyName, {
        isComplete: true,
        properties: new Map(),
        targets: [
          {
            bindings,
            functionNode: property,
            guards: [],
            isConditionallyReached: false,
          },
        ],
      });
      continue;
    }
    isComplete = false;
  }
  return { isComplete, properties, targets: [] };
};

const resolveArrayLiteral = (
  arrayLiteral: ts.ArrayLiteralExpression,
  typeChecker: ts.TypeChecker,
  bindings: ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor>,
  state: CallableResolutionState,
): ResolvedCallableValueDescriptor => {
  const properties = new Map<string, ResolvedCallableValueDescriptor>();
  let isComplete = true;
  for (const [elementIndex, element] of arrayLiteral.elements.entries()) {
    if (ts.isSpreadElement(element)) {
      isComplete = false;
      continue;
    }
    properties.set(
      String(elementIndex),
      ts.isOmittedExpression(element)
        ? createEmptyCallableValue(false)
        : resolveCallableExpressionWithState(element, typeChecker, bindings, state),
    );
  }
  return { isComplete, properties, targets: [] };
};

const bindObjectPattern = (
  bindingPattern: ts.ObjectBindingPattern,
  value: ResolvedCallableValueDescriptor,
  typeChecker: ts.TypeChecker,
  targetBindings: Map<ts.Symbol, ResolvedCallableValueDescriptor>,
): boolean => {
  let isComplete = value.isComplete;
  for (const bindingElement of bindingPattern.elements) {
    if (!ts.isIdentifier(bindingElement.name)) {
      isComplete = false;
      continue;
    }
    const propertyNameNode = bindingElement.propertyName ?? bindingElement.name;
    const propertyName =
      ts.isIdentifier(propertyNameNode) ||
      ts.isStringLiteral(propertyNameNode) ||
      ts.isNumericLiteral(propertyNameNode)
        ? propertyNameNode.text
        : null;
    const bindingSymbol = typeChecker.getSymbolAtLocation(bindingElement.name);
    const propertyValue = propertyName ? value.properties.get(propertyName) : null;
    if (!bindingSymbol || !propertyValue) {
      isComplete = false;
      continue;
    }
    targetBindings.set(bindingSymbol, propertyValue);
  }
  return isComplete;
};

const resolveCallableArgumentBindingsWithState = (
  targetFunction: ts.FunctionLikeDeclaration,
  callExpression: ts.CallExpression,
  typeChecker: ts.TypeChecker,
  bindings: ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor>,
  state: CallableResolutionState,
): CallableArgumentBindingsDescriptor => {
  const targetBindings = new Map<ts.Symbol, ResolvedCallableValueDescriptor>();
  const targetGuardBindings = new Map<ts.Symbol, ResolvedCallableGuardDescriptor>();
  let isComplete = true;
  for (const [parameterIndex, parameter] of targetFunction.parameters.entries()) {
    const argument = callExpression.arguments[parameterIndex];
    if (!argument) {
      if (parameterNeedsCallableBinding(parameter, typeChecker)) isComplete = false;
      continue;
    }
    const value = resolveCallableExpressionWithState(argument, typeChecker, bindings, state);
    if (ts.isIdentifier(parameter.name)) {
      const parameterSymbol = typeChecker.getSymbolAtLocation(parameter.name);
      const argumentGuard = getCallableGuard(argument, true, typeChecker, state);
      if (parameterSymbol && argumentGuard) {
        targetGuardBindings.set(parameterSymbol, argumentGuard);
      }
      if (parameterSymbol && (value.targets.length > 0 || value.properties.size > 0)) {
        targetBindings.set(parameterSymbol, value);
      } else if (parameterNeedsCallableBinding(parameter, typeChecker)) {
        isComplete = false;
      }
      continue;
    }
    if (ts.isObjectBindingPattern(parameter.name)) {
      if (!bindObjectPattern(parameter.name, value, typeChecker, targetBindings)) {
        isComplete = false;
      }
      continue;
    }
    if (parameterNeedsCallableBinding(parameter, typeChecker)) isComplete = false;
  }
  return { bindings: targetBindings, guardBindings: targetGuardBindings, isComplete };
};

export const resolveCallableArgumentBindings = (
  targetFunction: ts.FunctionLikeDeclaration,
  callExpression: ts.CallExpression,
  typeChecker: ts.TypeChecker,
  bindings: ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor>,
): CallableArgumentBindingsDescriptor =>
  resolveCallableArgumentBindingsWithState(targetFunction, callExpression, typeChecker, bindings, {
    guardBindings: new Map(),
    resolvingFunctions: new Set(),
    resolvingSymbols: new Set(),
  });

const resolveCallResult = (
  callExpression: ts.CallExpression,
  typeChecker: ts.TypeChecker,
  bindings: ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor>,
  state: CallableResolutionState,
): ResolvedCallableValueDescriptor => {
  if (getCanonicalReactApiName(callExpression.expression, typeChecker) === "useCallback") {
    const callbackExpression = callExpression.arguments[0];
    return callbackExpression
      ? resolveCallableExpressionWithState(callbackExpression, typeChecker, bindings, state)
      : createEmptyCallableValue(false);
  }
  const targetFunction = resolveFunction(callExpression.expression, typeChecker);
  if (!targetFunction || state.resolvingFunctions.has(targetFunction)) {
    return createEmptyCallableValue(false);
  }
  const returnSummary = summarizeFunctionReturns(targetFunction, typeChecker);
  if (returnSummary.expressions.length === 0) return createEmptyCallableValue(false);
  const argumentBindings = resolveCallableArgumentBindingsWithState(
    targetFunction,
    callExpression,
    typeChecker,
    bindings,
    state,
  );
  const resolvingFunctions = new Set(state.resolvingFunctions);
  resolvingFunctions.add(targetFunction);
  const returnBindings = mergeCallableBindings([bindings, argumentBindings.bindings]);
  const returnGuardBindings = new Map([...state.guardBindings, ...argumentBindings.guardBindings]);
  const returnValue = mergeCallableValues(
    returnSummary.expressions.map((returnExpression) => {
      const resolvedValue = resolveCallableExpressionWithState(
        returnExpression.expression,
        typeChecker,
        returnBindings,
        { ...state, guardBindings: returnGuardBindings, resolvingFunctions },
      );
      return returnExpression.isConditionallyReached
        ? markCallableValueConditional(resolvedValue)
        : resolvedValue;
    }),
  );
  const guardedReturnValue = removeUnsubstitutedCallableValueGuards(returnValue);
  return {
    ...guardedReturnValue,
    isComplete:
      returnSummary.isComplete &&
      !returnSummary.canFallThrough &&
      argumentBindings.isComplete &&
      guardedReturnValue.isComplete,
  };
};

const resolveSymbolValue = (
  symbol: ts.Symbol,
  typeChecker: ts.TypeChecker,
  bindings: ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor>,
  state: CallableResolutionState,
): ResolvedCallableValueDescriptor => {
  const boundValue = bindings.get(symbol);
  if (boundValue) return boundValue;
  if (state.resolvingSymbols.has(symbol)) return createEmptyCallableValue(false);
  const resolvingSymbols = new Set(state.resolvingSymbols);
  resolvingSymbols.add(symbol);
  for (const declaration of symbol.declarations ?? []) {
    const forOfBinding = getForOfBindingDescriptor(declaration);
    if (forOfBinding) {
      const iterableExpression = unwrapTypescriptExpression(forOfBinding.forOfStatement.expression);
      if (
        forOfBinding.isComplete &&
        ts.isVariableDeclarationList(forOfBinding.variableDeclaration.parent) &&
        Boolean(forOfBinding.variableDeclaration.parent.flags & ts.NodeFlags.Const) &&
        !forOfBinding.forOfStatement.awaitModifier &&
        ts.isArrayLiteralExpression(iterableExpression) &&
        iterableExpression.elements.length > 0 &&
        iterableExpression.elements.every((element) => !ts.isSpreadElement(element))
      ) {
        let iterationValue = mergeCallableValues(
          iterableExpression.elements.map((element) =>
            resolveCallableExpressionWithState(element, typeChecker, bindings, {
              ...state,
              resolvingSymbols,
            }),
          ),
        );
        for (const propertyName of forOfBinding.propertyPath) {
          const propertyValue = iterationValue.properties.get(propertyName);
          if (!propertyValue) return createEmptyCallableValue(false);
          iterationValue = {
            ...propertyValue,
            isComplete: iterationValue.isComplete && propertyValue.isComplete,
          };
        }
        return iterationValue;
      }
      return createEmptyCallableValue(false);
    }
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return resolveCallableExpressionWithState(declaration.initializer, typeChecker, bindings, {
        ...state,
        resolvingSymbols,
      });
    }
    if (ts.isBindingElement(declaration) && declaration.initializer) {
      const defaultValue = resolveCallableExpressionWithState(
        declaration.initializer,
        typeChecker,
        bindings,
        {
          ...state,
          resolvingSymbols,
        },
      );
      return {
        ...defaultValue,
        isComplete: false,
      };
    }
    if (
      ts.isBindingElement(declaration) &&
      ts.isObjectBindingPattern(declaration.parent) &&
      ts.isVariableDeclaration(declaration.parent.parent) &&
      declaration.parent.parent.initializer
    ) {
      const propertyNameNode = declaration.propertyName ?? declaration.name;
      const propertyName =
        ts.isIdentifier(propertyNameNode) ||
        ts.isStringLiteral(propertyNameNode) ||
        ts.isNumericLiteral(propertyNameNode)
          ? propertyNameNode.text
          : null;
      const objectValue = resolveCallableExpressionWithState(
        declaration.parent.parent.initializer,
        typeChecker,
        bindings,
        {
          ...state,
          resolvingSymbols,
        },
      );
      return propertyName
        ? (objectValue.properties.get(propertyName) ?? createEmptyCallableValue(false))
        : createEmptyCallableValue(false);
    }
  }
  return createEmptyCallableValue(false);
};

const resolveCallableExpressionWithState = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
  bindings: ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor>,
  state: CallableResolutionState,
): ResolvedCallableValueDescriptor => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (ts.isFunctionExpression(unwrappedExpression) || ts.isArrowFunction(unwrappedExpression)) {
    return {
      isComplete: true,
      properties: new Map(),
      targets: [
        {
          bindings,
          functionNode: unwrappedExpression,
          guards: [],
          isConditionallyReached: false,
        },
      ],
    };
  }
  if (ts.isObjectLiteralExpression(unwrappedExpression)) {
    return resolveObjectLiteral(unwrappedExpression, typeChecker, bindings, state);
  }
  if (ts.isArrayLiteralExpression(unwrappedExpression)) {
    return resolveArrayLiteral(unwrappedExpression, typeChecker, bindings, state);
  }
  if (ts.isConditionalExpression(unwrappedExpression)) {
    const whenTrueValue = markCallableValueConditional(
      resolveCallableExpressionWithState(
        unwrappedExpression.whenTrue,
        typeChecker,
        bindings,
        state,
      ),
    );
    const whenFalseValue = markCallableValueConditional(
      resolveCallableExpressionWithState(
        unwrappedExpression.whenFalse,
        typeChecker,
        bindings,
        state,
      ),
    );
    const whenTrueGuard = getCallableGuard(unwrappedExpression.condition, true, typeChecker, state);
    const whenFalseGuard = getCallableGuard(
      unwrappedExpression.condition,
      false,
      typeChecker,
      state,
    );
    return mergeCallableValues([
      whenTrueGuard ? addCallableValueGuard(whenTrueValue, whenTrueGuard) : whenTrueValue,
      whenFalseGuard ? addCallableValueGuard(whenFalseValue, whenFalseGuard) : whenFalseValue,
    ]);
  }
  if (
    ts.isBinaryExpression(unwrappedExpression) &&
    (unwrappedExpression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      unwrappedExpression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return mergeCallableValues([
      markCallableValueConditional(
        resolveCallableExpressionWithState(unwrappedExpression.left, typeChecker, bindings, state),
      ),
      markCallableValueConditional(
        resolveCallableExpressionWithState(unwrappedExpression.right, typeChecker, bindings, state),
      ),
    ]);
  }
  if (ts.isCallExpression(unwrappedExpression)) {
    return resolveCallResult(unwrappedExpression, typeChecker, bindings, state);
  }
  const directFunction = resolveFunction(unwrappedExpression, typeChecker);
  if (directFunction) {
    return {
      isComplete: true,
      properties: new Map(),
      targets: [
        {
          bindings,
          functionNode: directFunction,
          guards: [],
          isConditionallyReached: false,
        },
      ],
    };
  }
  if (ts.isPropertyAccessExpression(unwrappedExpression)) {
    const ownerValue = resolveCallableExpressionWithState(
      unwrappedExpression.expression,
      typeChecker,
      bindings,
      state,
    );
    const propertyValue = ownerValue.properties.get(unwrappedExpression.name.text);
    return propertyValue
      ? {
          ...propertyValue,
          isComplete: ownerValue.isComplete && propertyValue.isComplete,
        }
      : createEmptyCallableValue(false);
  }
  const expressionSymbol = typeChecker.getSymbolAtLocation(unwrappedExpression);
  return expressionSymbol
    ? resolveSymbolValue(expressionSymbol, typeChecker, bindings, state)
    : createEmptyCallableValue(false);
};

export const resolveCallableExpression = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
  bindings: ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor> = new Map(),
): ResolvedCallableValueDescriptor =>
  resolveCallableExpressionWithState(expression, typeChecker, bindings, {
    guardBindings: new Map(),
    resolvingFunctions: new Set(),
    resolvingSymbols: new Set(),
  });
