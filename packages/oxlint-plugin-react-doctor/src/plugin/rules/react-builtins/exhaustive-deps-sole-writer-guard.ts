import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import {
  stripParenExpression,
  TRANSPARENT_EXPRESSION_WRAPPER_TYPES,
} from "../../utils/strip-paren-expression.js";

const EQUALITY_BINARY_OPERATORS: ReadonlySet<string> = new Set(["===", "!=="]);

interface DirectSetterWrite {
  callExpression: EsTreeNode;
  writtenValue: EsTreeNode;
}

interface EqualityComparison {
  comparison: EsTreeNode;
  counterpart: EsTreeNode;
  areValuesEqualWhenTruthy: boolean;
}

const getUseStateSetterSymbol = (
  stateSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const declaration = stateSymbol.declarationNode;
  if (!isNodeOfType(declaration, "VariableDeclarator")) return null;
  if (!isNodeOfType(declaration.id, "ArrayPattern")) return null;
  const stateBinding = declaration.id.elements[0];
  const setterBinding = declaration.id.elements[1];
  if (
    stateBinding !== stateSymbol.bindingIdentifier ||
    !isNodeOfType(setterBinding, "Identifier")
  ) {
    return null;
  }
  const initializer = declaration.init ? stripParenExpression(declaration.init) : null;
  if (
    !initializer ||
    !isReactApiCall(initializer, "useState", scopes, {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: true,
      resolveNamedAliases: true,
    })
  ) {
    return null;
  }
  return scopes.symbolFor(setterBinding);
};

const getDirectSetterCall = (
  setterSymbol: SymbolDescriptor,
  callback: EsTreeNode,
): DirectSetterWrite | null => {
  if (setterSymbol.references.length !== 1) return null;
  const setterReference = setterSymbol.references[0];
  if (setterReference.flag !== "read") return null;
  const referenceRoot = findTransparentExpressionRoot(setterReference.identifier);
  const callExpression = referenceRoot.parent;
  if (
    !isNodeOfType(callExpression, "CallExpression") ||
    callExpression.callee !== referenceRoot ||
    callExpression.arguments.length !== 1 ||
    findEnclosingFunction(callExpression) !== callback
  ) {
    return null;
  }
  const writtenValue = stripParenExpression(callExpression.arguments[0]);
  if (
    isNodeOfType(writtenValue, "ArrowFunctionExpression") ||
    isNodeOfType(writtenValue, "FunctionExpression") ||
    isNodeOfType(writtenValue, "SpreadElement")
  ) {
    return null;
  }
  return { callExpression, writtenValue };
};

const isGlobalObjectIsCall = (callExpression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(callExpression, "CallExpression")) return false;
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const propertyName = getStaticPropertyName(callee);
  const receiver = stripParenExpression(callee.object);
  return Boolean(
    propertyName === "is" &&
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "Object" &&
    scopes.isGlobalReference(receiver),
  );
};

const isGlobalNaNReference = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  return (
    isNodeOfType(unwrappedExpression, "Identifier") &&
    unwrappedExpression.name === "NaN" &&
    scopes.isGlobalReference(unwrappedExpression)
  );
};

const getEqualityComparison = (
  stateReference: EsTreeNode,
  candidate: EsTreeNode,
  scopes: ScopeAnalysis,
): EqualityComparison | null => {
  const unwrappedStateReference = stripParenExpression(stateReference);
  if (
    isNodeOfType(candidate, "BinaryExpression") &&
    EQUALITY_BINARY_OPERATORS.has(candidate.operator)
  ) {
    if (stripParenExpression(candidate.left) === unwrappedStateReference) {
      return isGlobalNaNReference(candidate.right, scopes)
        ? null
        : {
            comparison: candidate,
            counterpart: candidate.right,
            areValuesEqualWhenTruthy: candidate.operator === "===",
          };
    }
    if (stripParenExpression(candidate.right) === unwrappedStateReference) {
      return isGlobalNaNReference(candidate.left, scopes)
        ? null
        : {
            comparison: candidate,
            counterpart: candidate.left,
            areValuesEqualWhenTruthy: candidate.operator === "===",
          };
    }
    return null;
  }
  if (
    !isNodeOfType(candidate, "CallExpression") ||
    !isGlobalObjectIsCall(candidate, scopes) ||
    candidate.arguments.length !== 2
  ) {
    return null;
  }
  const firstArgument = candidate.arguments[0];
  const secondArgument = candidate.arguments[1];
  if (
    isNodeOfType(firstArgument, "SpreadElement") ||
    isNodeOfType(secondArgument, "SpreadElement")
  ) {
    return null;
  }
  if (stripParenExpression(firstArgument) === unwrappedStateReference) {
    return {
      comparison: candidate,
      counterpart: secondArgument,
      areValuesEqualWhenTruthy: true,
    };
  }
  if (stripParenExpression(secondArgument) === unwrappedStateReference) {
    return {
      comparison: candidate,
      counterpart: firstArgument,
      areValuesEqualWhenTruthy: true,
    };
  }
  return null;
};

const findEqualityComparison = (
  stateReference: EsTreeNode,
  test: EsTreeNode,
  scopes: ScopeAnalysis,
): EqualityComparison | null => {
  let current: EsTreeNode | null | undefined = stateReference.parent;
  while (current && isAstDescendant(current, test)) {
    const comparison = getEqualityComparison(stateReference, current, scopes);
    if (comparison) return comparison;
    if (current === test) break;
    current = current.parent;
  }
  return null;
};

const doesTestOutcomeRequireComparisonOutcome = (
  comparison: EsTreeNode,
  test: EsTreeNode,
  testOutcome: boolean,
  comparisonOutcome: boolean,
): boolean => {
  let requiredChildOutcome = testOutcome;
  let current = comparison;
  while (current !== test) {
    const parent = current.parent;
    if (!parent || !isAstDescendant(parent, test)) return false;
    if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") {
      requiredChildOutcome = !requiredChildOutcome;
    } else if (isNodeOfType(parent, "LogicalExpression")) {
      if (parent.operator === "&&" && !requiredChildOutcome) return false;
      if (parent.operator === "||" && requiredChildOutcome) return false;
      if (parent.operator !== "&&" && parent.operator !== "||") return false;
    } else if (!TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(parent.type)) {
      return false;
    }
    current = parent;
  }
  return requiredChildOutcome === comparisonOutcome;
};

const resolveImmutableAliasExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode => {
  const visitedSymbolIds = new Set<number>();
  let current = stripParenExpression(expression);
  while (isNodeOfType(current, "Identifier")) {
    const symbol = scopes.symbolFor(current);
    if (!symbol || visitedSymbolIds.has(symbol.id)) break;
    const initializer = getDirectConstInitializer(symbol);
    if (!initializer || !isNodeOfType(stripParenExpression(initializer), "Identifier")) break;
    visitedSymbolIds.add(symbol.id);
    current = stripParenExpression(initializer);
  }
  return current;
};

const referencesSameValue = (
  leftExpression: EsTreeNode,
  rightExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const left = resolveImmutableAliasExpression(leftExpression, scopes);
  const right = resolveImmutableAliasExpression(rightExpression, scopes);
  if (left === right) return true;
  if (isNodeOfType(left, "Identifier") && isNodeOfType(right, "Identifier")) {
    const leftSymbol = scopes.symbolFor(left);
    const rightSymbol = scopes.symbolFor(right);
    if (leftSymbol || rightSymbol) return leftSymbol?.id === rightSymbol?.id;
    return left.name === right.name;
  }
  if (isNodeOfType(left, "Literal") && isNodeOfType(right, "Literal")) {
    return Object.is(left.value, right.value);
  }
  return false;
};

const hasDeclaredTriggerDependency = (callback: EsTreeNode): boolean => {
  const callbackRoot = findTransparentExpressionRoot(callback);
  const hookCall = callbackRoot.parent;
  if (!isNodeOfType(hookCall, "CallExpression")) return false;
  const dependencyArray = hookCall.arguments[1];
  return Boolean(
    isNodeOfType(dependencyArray, "ArrayExpression") && dependencyArray.elements.length,
  );
};

const doesBranchExitEffect = (branch: EsTreeNode): boolean => {
  if (isNodeOfType(branch, "ReturnStatement") || isNodeOfType(branch, "ThrowStatement")) {
    return true;
  }
  if (!isNodeOfType(branch, "BlockStatement")) return false;
  const terminalStatement = branch.body.at(-1);
  return Boolean(terminalStatement && doesBranchExitEffect(terminalStatement));
};

const doesGuardDominateLaterSetter = (guard: EsTreeNode, setterCall: EsTreeNode): boolean => {
  if (!isNodeOfType(guard, "IfStatement") || guard.alternate) return false;
  if (!doesBranchExitEffect(guard.consequent)) return false;
  const block = guard.parent;
  if (!isNodeOfType(block, "BlockStatement")) return false;
  const guardIndex = block.body.findIndex((statement) => statement === guard);
  return block.body.some(
    (statement, statementIndex) =>
      statementIndex > guardIndex && isAstDescendant(setterCall, statement),
  );
};

const findDominatingGuardCounterpart = (
  stateReference: EsTreeNode,
  setterCall: EsTreeNode,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  let current: EsTreeNode | null | undefined = stateReference.parent;
  while (current && current !== callback) {
    if (
      isNodeOfType(current, "IfStatement") &&
      isAstDescendant(stateReference, current.test) &&
      (isAstDescendant(setterCall, current.consequent) ||
        Boolean(current.alternate && isAstDescendant(setterCall, current.alternate)) ||
        doesGuardDominateLaterSetter(current, setterCall))
    ) {
      const setterRunsWhenTestTruthy = isAstDescendant(setterCall, current.consequent);
      const setterRunsWhenTestFalsey =
        Boolean(current.alternate && isAstDescendant(setterCall, current.alternate)) ||
        doesGuardDominateLaterSetter(current, setterCall);
      if (setterRunsWhenTestTruthy === setterRunsWhenTestFalsey) return null;
      const equalityComparison = findEqualityComparison(stateReference, current.test, scopes);
      if (!equalityComparison) return null;
      const comparisonOutcomeForDifferentValues = !equalityComparison.areValuesEqualWhenTruthy;
      if (
        !doesTestOutcomeRequireComparisonOutcome(
          equalityComparison.comparison,
          current.test,
          setterRunsWhenTestTruthy,
          comparisonOutcomeForDifferentValues,
        )
      ) {
        return null;
      }
      return equalityComparison.counterpart;
    }
    current = current.parent;
  }
  return null;
};

export const isSoleWriterEffectGuardCapture = (
  stateSymbol: SymbolDescriptor,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!hasDeclaredTriggerDependency(callback)) return false;
  if (stateSymbol.references.some((reference) => reference.flag !== "read")) return false;
  const setterSymbol = getUseStateSetterSymbol(stateSymbol, scopes);
  if (!setterSymbol) return false;
  const setterWrite = getDirectSetterCall(setterSymbol, callback);
  if (!setterWrite) return false;
  const callbackStateReferences = stateSymbol.references.filter((reference) =>
    isAstDescendant(reference.identifier, callback),
  );
  if (callbackStateReferences.length !== 1) return false;
  const stateReferenceRoot = findTransparentExpressionRoot(callbackStateReferences[0].identifier);
  if (
    isNodeOfType(stateReferenceRoot.parent, "MemberExpression") &&
    stateReferenceRoot.parent.object === stateReferenceRoot
  ) {
    return false;
  }
  const counterpart = findDominatingGuardCounterpart(
    callbackStateReferences[0].identifier,
    setterWrite.callExpression,
    callback,
    scopes,
  );
  return Boolean(counterpart && referencesSameValue(counterpart, setterWrite.writtenValue, scopes));
};
