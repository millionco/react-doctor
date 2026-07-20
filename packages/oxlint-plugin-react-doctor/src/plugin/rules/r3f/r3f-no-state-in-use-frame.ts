import { defineRule } from "../../utils/define-rule.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { hasPossibleStaticPropertyWrite } from "../../utils/has-static-property-write-before.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveReactRefSymbol } from "../../utils/react-ref-origin.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { walkAst } from "../../utils/walk-ast.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { isR3fReactApiCall } from "./utils/is-r3f-react-api-call.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const STATE_HOOKS = new Set(["useState", "useReducer"]);
const USE_STATE_HOOK = new Set(["useState"]);
const VALUE_CHANGE_OPERATORS = new Set(["!==", "!=", "===", "=="]);
const REPEATED_EXECUTION_NODE_TYPES: ReadonlySet<string> = new Set([
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "WhileStatement",
]);

interface StateSetterBinding {
  stateSymbolId: number | null;
}

interface BoundaryTransitions {
  above: Set<boolean>;
  below: Set<boolean>;
}

interface NumericRefBoundary {
  operator: string;
  refSymbolId: number;
  threshold: number;
}

const isStateHookTuple = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isR3fReactApiCall(candidate, STATE_HOOKS, scopes, { resolveNamedAliases: true })) {
    return true;
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return isStateHookTuple(symbol.initializer, scopes, visitedSymbolIds);
};

export const resolveStateSetterBinding = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): StateSetterBinding | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "MemberExpression")) {
    const property = stripParenExpression(candidate.property);
    if (!candidate.computed || !isNodeOfType(property, "Literal") || property.value !== 1) {
      return null;
    }
    const tupleExpression = stripParenExpression(candidate.object);
    if (
      isNodeOfType(tupleExpression, "Identifier") &&
      hasPossibleStaticPropertyWrite(tupleExpression, "1", scopes)
    ) {
      return null;
    }
    return isStateHookTuple(tupleExpression, scopes, visitedSymbolIds)
      ? { stateSymbolId: null }
      : null;
  }
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
  visitedSymbolIds.add(symbol.id);
  const declaration = symbol.declarationNode;
  if (
    isNodeOfType(declaration, "VariableDeclarator") &&
    declaration.init &&
    isNodeOfType(declaration.id, "ArrayPattern") &&
    declaration.id.elements[1] === symbol.bindingIdentifier &&
    isR3fReactApiCall(declaration.init, STATE_HOOKS, scopes, {
      resolveNamedAliases: true,
    })
  ) {
    const stateIdentifier = declaration.id.elements[0];
    const stateSymbolId =
      stateIdentifier &&
      isNodeOfType(stateIdentifier, "Identifier") &&
      isR3fReactApiCall(declaration.init, USE_STATE_HOOK, scopes, {
        resolveNamedAliases: true,
      })
        ? (scopes.symbolFor(stateIdentifier)?.id ?? null)
        : null;
    return { stateSymbolId };
  }
  if (
    symbol.kind !== "const" ||
    !symbol.initializer ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.id !== symbol.bindingIdentifier
  ) {
    return null;
  }
  return resolveStateSetterBinding(symbol.initializer, scopes, visitedSymbolIds);
};

const branchGuaranteesBooleanState = (
  test: EsTreeNode,
  didTestPass: boolean,
  stateSymbolId: number,
  expectedValue: boolean,
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = stripParenExpression(test);
  if (isNodeOfType(candidate, "Identifier")) {
    return scopes.symbolFor(candidate)?.id === stateSymbolId && didTestPass === expectedValue;
  }
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "!") {
    return branchGuaranteesBooleanState(
      candidate.argument,
      !didTestPass,
      stateSymbolId,
      expectedValue,
      scopes,
    );
  }
  if (!isNodeOfType(candidate, "LogicalExpression")) return false;
  const leftGuarantees = branchGuaranteesBooleanState(
    candidate.left,
    didTestPass,
    stateSymbolId,
    expectedValue,
    scopes,
  );
  const rightGuarantees = branchGuaranteesBooleanState(
    candidate.right,
    didTestPass,
    stateSymbolId,
    expectedValue,
    scopes,
  );
  const requiresEveryOperand = (candidate.operator === "&&") !== didTestPass;
  return requiresEveryOperand
    ? leftGuarantees && rightGuarantees
    : leftGuarantees || rightGuarantees;
};

const callbackCallsStateSetterMoreThanOnce = (
  callback: EsTreeNode,
  stateSymbolId: number,
  scopes: ScopeAnalysis,
): boolean => {
  let setterCallCount = 0;
  walkAst(callback, (candidate) => {
    if (setterCallCount > 1) return false;
    if (candidate !== callback && isFunctionLike(candidate)) return false;
    if (!isNodeOfType(candidate, "CallExpression")) {
      return;
    }
    if (resolveStateSetterBinding(candidate.callee, scopes)?.stateSymbolId === stateSymbolId) {
      setterCallCount += 1;
    }
  });
  return setterCallCount > 1;
};

const isLatchTransitionGuaranteedForSetter = (
  latchCall: EsTreeNode,
  setterCall: EsTreeNode,
  branch: EsTreeNode,
): boolean => {
  if (latchCall === branch) return true;
  let currentChild = latchCall;
  let currentAncestor = latchCall.parent;
  while (currentAncestor && currentAncestor !== branch) {
    let conditionalRegion: EsTreeNode | null = null;
    if (isNodeOfType(currentAncestor, "IfStatement") && currentAncestor.test !== currentChild) {
      conditionalRegion = currentChild;
    }
    if (
      isNodeOfType(currentAncestor, "ConditionalExpression") &&
      (currentAncestor.consequent === currentChild || currentAncestor.alternate === currentChild)
    ) {
      conditionalRegion = currentChild;
    }
    if (
      isNodeOfType(currentAncestor, "LogicalExpression") &&
      currentAncestor.right === currentChild
    ) {
      conditionalRegion = currentChild;
    }
    if (
      isNodeOfType(currentAncestor, "AssignmentPattern") &&
      currentAncestor.right === currentChild
    ) {
      conditionalRegion = currentChild;
    }
    if (isNodeOfType(currentAncestor, "SwitchCase")) conditionalRegion = currentAncestor;
    if (conditionalRegion && !isAstDescendant(setterCall, conditionalRegion)) return false;
    currentChild = currentAncestor;
    currentAncestor = currentAncestor.parent;
  }
  return currentAncestor === branch;
};

const branchHasBooleanLatchTransition = (
  branch: EsTreeNode,
  setterCall: EsTreeNode,
  callback: EsTreeNode,
  test: EsTreeNode,
  didTestPass: boolean,
  scopes: ScopeAnalysis,
): boolean => {
  let didFindLatch = false;
  walkAst(branch, (candidate) => {
    if (didFindLatch) return false;
    if (candidate !== branch && isFunctionLike(candidate)) return false;
    if (!isNodeOfType(candidate, "CallExpression")) {
      return;
    }
    const stateSymbolId = resolveStateSetterBinding(candidate.callee, scopes)?.stateSymbolId;
    const nextState = candidate.arguments[0];
    if (
      stateSymbolId === null ||
      stateSymbolId === undefined ||
      !nextState ||
      isNodeOfType(nextState, "SpreadElement")
    ) {
      return;
    }
    const nextStateCandidate = stripParenExpression(nextState);
    if (
      !isNodeOfType(nextStateCandidate, "Literal") ||
      typeof nextStateCandidate.value !== "boolean" ||
      !branchGuaranteesBooleanState(
        test,
        didTestPass,
        stateSymbolId,
        !nextStateCandidate.value,
        scopes,
      ) ||
      callbackCallsStateSetterMoreThanOnce(callback, stateSymbolId, scopes) ||
      !isLatchTransitionGuaranteedForSetter(candidate, setterCall, branch)
    ) {
      return;
    }
    didFindLatch = true;
    return false;
  });
  return didFindLatch;
};

const resolveCurrentRefSymbolId = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): number | null => {
  const candidate = stripParenExpression(expression);
  if (
    !isNodeOfType(candidate, "MemberExpression") ||
    getStaticPropertyName(candidate) !== "current"
  ) {
    return null;
  }
  return resolveReactRefSymbol(candidate, scopes, { resolveNamedAliases: true })?.id ?? null;
};

const getNumericRefBoundary = (
  test: EsTreeNode,
  scopes: ScopeAnalysis,
): NumericRefBoundary | null => {
  const candidate = stripParenExpression(test);
  if (
    !isNodeOfType(candidate, "BinaryExpression") ||
    !["<", "<=", ">", ">="].includes(candidate.operator)
  ) {
    return null;
  }
  const leftRefSymbolId = resolveCurrentRefSymbolId(candidate.left, scopes);
  const rightRefSymbolId = resolveCurrentRefSymbolId(candidate.right, scopes);
  if ((leftRefSymbolId === null) === (rightRefSymbolId === null)) return null;
  const threshold = getStaticNumber(
    leftRefSymbolId === null ? candidate.left : candidate.right,
    scopes,
  );
  if (threshold === null || !Number.isFinite(threshold)) return null;
  let operator = candidate.operator;
  if (rightRefSymbolId !== null) {
    if (operator === "<") operator = ">";
    else if (operator === "<=") operator = ">=";
    else if (operator === ">") operator = "<";
    else operator = "<=";
  }
  const refSymbolId = leftRefSymbolId ?? rightRefSymbolId;
  if (refSymbolId === null) return null;
  return {
    operator,
    refSymbolId,
    threshold,
  };
};

const doesValuePassNumericBoundary = (value: number, boundary: NumericRefBoundary): boolean => {
  if (boundary.operator === "<") return value < boundary.threshold;
  if (boundary.operator === "<=") return value <= boundary.threshold;
  if (boundary.operator === ">") return value > boundary.threshold;
  return value >= boundary.threshold;
};

const getWrittenCurrentRefSymbolId = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): number | null => {
  if (isNodeOfType(expression, "AssignmentExpression")) {
    return resolveCurrentRefSymbolId(expression.left, scopes);
  }
  if (isNodeOfType(expression, "UpdateExpression")) {
    return resolveCurrentRefSymbolId(expression.argument, scopes);
  }
  return null;
};

const isInsideRepeatedExecution = (node: EsTreeNode, boundary: EsTreeNode): boolean => {
  let current = node.parent;
  while (current && current !== boundary) {
    if (REPEATED_EXECUTION_NODE_TYPES.has(current.type)) return true;
    current = current.parent;
  }
  return false;
};

const branchHasNumericRefReset = (
  branch: EsTreeNode,
  setterCall: EsTreeNode,
  test: EsTreeNode,
  didTestPass: boolean,
  scopes: ScopeAnalysis,
): boolean => {
  const boundary = getNumericRefBoundary(test, scopes);
  if (!boundary || isInsideRepeatedExecution(setterCall, branch)) return false;
  const refWritesBeforeSetter: EsTreeNode[] = [];
  walkAst(branch, (candidate) => {
    if (candidate !== branch && isFunctionLike(candidate)) return false;
    if (
      candidate.range[0] < setterCall.range[0] &&
      getWrittenCurrentRefSymbolId(candidate, scopes) === boundary.refSymbolId
    ) {
      refWritesBeforeSetter.push(candidate);
    }
  });
  const latestRefWrite = refWritesBeforeSetter.reduce<EsTreeNode | null>(
    (latestWrite, candidate) =>
      !latestWrite || candidate.range[0] > latestWrite.range[0] ? candidate : latestWrite,
    null,
  );
  if (
    !latestRefWrite ||
    !isNodeOfType(latestRefWrite, "AssignmentExpression") ||
    latestRefWrite.operator !== "=" ||
    isNodeConditionallyExecuted(latestRefWrite, branch) ||
    isInsideRepeatedExecution(latestRefWrite, branch) ||
    !isLatchTransitionGuaranteedForSetter(latestRefWrite, setterCall, branch)
  ) {
    return false;
  }
  const resetValue = getStaticNumber(latestRefWrite.right, scopes);
  return (
    resetValue !== null &&
    Number.isFinite(resetValue) &&
    doesValuePassNumericBoundary(resetValue, boundary) !== didTestPass
  );
};

const branchGuaranteesRefBoolean = (
  test: EsTreeNode,
  didTestPass: boolean,
  refSymbolId: number,
  expectedValue: boolean,
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = stripParenExpression(test);
  if (resolveCurrentRefSymbolId(candidate, scopes) === refSymbolId) {
    return didTestPass === expectedValue;
  }
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "!") {
    return branchGuaranteesRefBoolean(
      candidate.argument,
      !didTestPass,
      refSymbolId,
      expectedValue,
      scopes,
    );
  }
  if (!isNodeOfType(candidate, "LogicalExpression")) return false;
  const leftGuarantees = branchGuaranteesRefBoolean(
    candidate.left,
    didTestPass,
    refSymbolId,
    expectedValue,
    scopes,
  );
  const rightGuarantees = branchGuaranteesRefBoolean(
    candidate.right,
    didTestPass,
    refSymbolId,
    expectedValue,
    scopes,
  );
  const requiresEveryOperand = (candidate.operator === "&&") !== didTestPass;
  return requiresEveryOperand
    ? leftGuarantees && rightGuarantees
    : leftGuarantees || rightGuarantees;
};

const branchHasRefLatchTransition = (
  branch: EsTreeNode,
  setterCall: EsTreeNode,
  test: EsTreeNode,
  didTestPass: boolean,
  scopes: ScopeAnalysis,
): boolean => {
  let didFindLatch = false;
  walkAst(branch, (candidate) => {
    if (didFindLatch) return false;
    if (candidate !== branch && isFunctionLike(candidate)) return false;
    if (
      !isNodeOfType(candidate, "AssignmentExpression") ||
      candidate.operator !== "=" ||
      candidate.range[0] >= setterCall.range[0] ||
      isNodeConditionallyExecuted(candidate, branch)
    ) {
      return;
    }
    const refSymbolId = resolveCurrentRefSymbolId(candidate.left, scopes);
    const assignedValue = stripParenExpression(candidate.right);
    if (
      refSymbolId === null ||
      !isNodeOfType(assignedValue, "Literal") ||
      typeof assignedValue.value !== "boolean" ||
      !branchGuaranteesRefBoolean(test, didTestPass, refSymbolId, !assignedValue.value, scopes) ||
      !isLatchTransitionGuaranteedForSetter(candidate, setterCall, branch)
    ) {
      return;
    }
    didFindLatch = true;
    return false;
  });
  return didFindLatch;
};

const getStableExpressionKey = (expression: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  const propertyNames: string[] = [];
  let current = stripParenExpression(expression);
  while (isNodeOfType(current, "MemberExpression")) {
    const propertyName = getStaticPropertyName(current);
    if (!propertyName) return null;
    propertyNames.unshift(propertyName);
    current = stripParenExpression(current.object);
  }
  if (!isNodeOfType(current, "Identifier")) return null;
  const symbol = scopes.symbolFor(current);
  return symbol ? `${symbol.id}:${propertyNames.join(".")}` : null;
};

const getRelationalBoundary = (
  test: EsTreeNode,
  scopes: ScopeAnalysis,
): readonly [string, "above" | "below"] | null => {
  const candidate = stripParenExpression(test);
  if (
    !isNodeOfType(candidate, "BinaryExpression") ||
    !["<", "<=", ">", ">="].includes(candidate.operator)
  ) {
    return null;
  }
  const leftIsBoundary = isPrimitiveComparisonBoundary(candidate.left);
  const rightIsBoundary = isPrimitiveComparisonBoundary(candidate.right);
  if (leftIsBoundary === rightIsBoundary) return null;
  const valueExpression = leftIsBoundary ? candidate.right : candidate.left;
  const expressionKey = getStableExpressionKey(valueExpression, scopes);
  if (!expressionKey) return null;
  const pointsAbove = leftIsBoundary
    ? candidate.operator === "<" || candidate.operator === "<="
    : candidate.operator === ">" || candidate.operator === ">=";
  return [expressionKey, pointsAbove ? "above" : "below"];
};

const isBoundedBooleanStateTransition = (
  setterCall: EsTreeNode,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(setterCall, "CallExpression")) return false;
  const nextState = setterCall.arguments[0];
  if (!nextState || isNodeOfType(nextState, "SpreadElement")) return false;
  const nextStateCandidate = stripParenExpression(nextState);
  if (
    !isNodeOfType(nextStateCandidate, "Literal") ||
    typeof nextStateCandidate.value !== "boolean"
  ) {
    return false;
  }
  const setterBinding = resolveStateSetterBinding(setterCall.callee, scopes);
  if (setterBinding?.stateSymbolId === null || setterBinding?.stateSymbolId === undefined) {
    return false;
  }
  let containingIf: EsTreeNodeOfType<"IfStatement"> | null = null;
  let current = setterCall.parent;
  while (current && current !== callback) {
    if (isNodeOfType(current, "IfStatement")) {
      containingIf = current;
      break;
    }
    current = current.parent;
  }
  if (!containingIf) return false;
  while (
    isNodeOfType(containingIf.parent, "IfStatement") &&
    containingIf.parent.alternate === containingIf
  ) {
    containingIf = containingIf.parent;
  }
  const transitionsByExpression = new Map<string, BoundaryTransitions>();
  let setterBoundary: readonly [string, "above" | "below"] | null = null;
  let branch: EsTreeNodeOfType<"IfStatement"> | null = containingIf;
  while (branch) {
    const boundary = getRelationalBoundary(branch.test, scopes);
    const branchSetterCalls: EsTreeNodeOfType<"CallExpression">[] = [];
    const branchTransitionValues: boolean[] = [];
    const branchConsequent = branch.consequent;
    walkAst(branchConsequent, (candidate) => {
      if (candidate !== branchConsequent && isFunctionLike(candidate)) return false;
      if (
        !isNodeOfType(candidate, "CallExpression") ||
        isNodeConditionallyExecuted(candidate, branchConsequent)
      ) {
        return;
      }
      const candidateBinding = resolveStateSetterBinding(candidate.callee, scopes);
      const nextState = candidate.arguments[0];
      if (
        candidateBinding?.stateSymbolId !== setterBinding.stateSymbolId ||
        !nextState ||
        isNodeOfType(nextState, "SpreadElement")
      ) {
        return;
      }
      const nextStateCandidate = stripParenExpression(nextState);
      if (
        isNodeOfType(nextStateCandidate, "Literal") &&
        typeof nextStateCandidate.value === "boolean"
      ) {
        branchSetterCalls.push(candidate);
        branchTransitionValues.push(nextStateCandidate.value);
      }
    });
    if (boundary && branchSetterCalls.length === 1) {
      const transitionValue = branchTransitionValues[0];
      const transitions = transitionsByExpression.get(boundary[0]) ?? {
        above: new Set<boolean>(),
        below: new Set<boolean>(),
      };
      transitions[boundary[1]].add(transitionValue);
      transitionsByExpression.set(boundary[0], transitions);
      if (branchSetterCalls[0] === setterCall) setterBoundary = boundary;
    }
    branch = isNodeOfType(branch.alternate, "IfStatement") ? branch.alternate : null;
  }
  if (!setterBoundary) return false;
  const oppositeDirection = setterBoundary[1] === "above" ? "below" : "above";
  return Boolean(
    transitionsByExpression
      .get(setterBoundary[0])
      ?.[oppositeDirection].has(!nextStateCandidate.value),
  );
};

const isPrimitiveComparisonBoundary = (node: EsTreeNode): boolean => {
  const candidate = stripParenExpression(node);
  return (
    isNodeOfType(candidate, "Literal") ||
    (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "void") ||
    (isNodeOfType(candidate, "Identifier") &&
      (candidate.name === "undefined" || candidate.name === "NaN" || candidate.name === "Infinity"))
  );
};

const branchGuaranteesValueChange = (
  test: EsTreeNode,
  didTestPass: boolean,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(test);
  if (
    isNodeOfType(candidate, "BinaryExpression") &&
    VALUE_CHANGE_OPERATORS.has(candidate.operator) &&
    !isPrimitiveComparisonBoundary(candidate.left) &&
    !isPrimitiveComparisonBoundary(candidate.right)
  ) {
    const isInequality = candidate.operator === "!==" || candidate.operator === "!=";
    return didTestPass === isInequality;
  }
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "!") {
    return branchGuaranteesValueChange(candidate.argument, !didTestPass, scopes, visitedSymbolIds);
  }
  if (isNodeOfType(candidate, "LogicalExpression")) {
    const leftGuarantees = branchGuaranteesValueChange(
      candidate.left,
      didTestPass,
      scopes,
      new Set(visitedSymbolIds),
    );
    const rightGuarantees = branchGuaranteesValueChange(
      candidate.right,
      didTestPass,
      scopes,
      new Set(visitedSymbolIds),
    );
    const requiresEveryOperand = (candidate.operator === "&&") !== didTestPass;
    return requiresEveryOperand
      ? leftGuarantees && rightGuarantees
      : leftGuarantees || rightGuarantees;
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return branchGuaranteesValueChange(symbol.initializer, didTestPass, scopes, visitedSymbolIds);
};

export const isGuardedStateTransition = (
  setterCall: EsTreeNode,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let currentChild = setterCall;
  let currentAncestor = setterCall.parent;
  while (currentAncestor && currentAncestor !== callback) {
    if (isNodeOfType(currentAncestor, "CatchClause")) return true;
    if (isNodeOfType(currentAncestor, "IfStatement")) {
      const didTestPass =
        currentAncestor.consequent === currentChild
          ? true
          : currentAncestor.alternate === currentChild
            ? false
            : null;
      if (
        didTestPass !== null &&
        (branchGuaranteesValueChange(currentAncestor.test, didTestPass, scopes) ||
          branchHasBooleanLatchTransition(
            currentChild,
            setterCall,
            callback,
            currentAncestor.test,
            didTestPass,
            scopes,
          ) ||
          branchHasRefLatchTransition(
            currentChild,
            setterCall,
            currentAncestor.test,
            didTestPass,
            scopes,
          ) ||
          branchHasNumericRefReset(
            currentChild,
            setterCall,
            currentAncestor.test,
            didTestPass,
            scopes,
          ) ||
          isBoundedBooleanStateTransition(setterCall, callback, scopes))
      ) {
        return true;
      }
    }
    if (isNodeOfType(currentAncestor, "ConditionalExpression")) {
      const didTestPass =
        currentAncestor.consequent === currentChild
          ? true
          : currentAncestor.alternate === currentChild
            ? false
            : null;
      if (
        didTestPass !== null &&
        (branchGuaranteesValueChange(currentAncestor.test, didTestPass, scopes) ||
          branchHasBooleanLatchTransition(
            currentChild,
            setterCall,
            callback,
            currentAncestor.test,
            didTestPass,
            scopes,
          ) ||
          branchHasRefLatchTransition(
            currentChild,
            setterCall,
            currentAncestor.test,
            didTestPass,
            scopes,
          ))
      ) {
        return true;
      }
    }
    if (
      isNodeOfType(currentAncestor, "LogicalExpression") &&
      currentAncestor.right === currentChild &&
      (currentAncestor.operator === "&&" || currentAncestor.operator === "||")
    ) {
      const didTestPass = currentAncestor.operator === "&&";
      if (
        branchGuaranteesValueChange(currentAncestor.left, didTestPass, scopes) ||
        branchHasBooleanLatchTransition(
          currentChild,
          setterCall,
          callback,
          currentAncestor.left,
          didTestPass,
          scopes,
        ) ||
        branchHasRefLatchTransition(
          currentChild,
          setterCall,
          currentAncestor.left,
          didTestPass,
          scopes,
        )
      ) {
        return true;
      }
    }
    currentChild = currentAncestor;
    currentAncestor = currentAncestor.parent;
  }
  return false;
};

export const r3fNoStateInUseFrame = defineRule({
  id: "r3f-no-state-in-use-frame",
  title: "React state update inside useFrame",
  severity: "warn",
  recommendation:
    "Mutate Three.js refs or an external transient store inside useFrame; reserve React state for guarded, infrequent transitions",
  create: (context: RuleContext) => {
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveR3fCallback(node, "useFrame", context.scopes);
        if (!callback) return;
        walkFunctionExecution(callback, context.scopes, (candidate) => {
          if (!isNodeOfType(candidate, "CallExpression")) {
            return;
          }
          if (
            !resolveStateSetterBinding(candidate.callee, context.scopes) ||
            isGuardedStateTransition(candidate, callback, context.scopes)
          ) {
            return;
          }
          context.report({
            node: candidate,
            message:
              "This React state update can schedule a component render every frame. Mutate a Three.js ref or transient store, or guard an infrequent state transition",
          });
        });
      },
    };
  },
});
