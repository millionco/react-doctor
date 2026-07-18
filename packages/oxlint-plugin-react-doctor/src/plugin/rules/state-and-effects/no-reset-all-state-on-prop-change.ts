import type { Reference } from "eslint-scope";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import { executesDuringRender } from "../../utils/executes-during-render.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { hasEnclosingTypeParameterNamed } from "../../utils/has-enclosing-type-parameter-named.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { isOutsideAllFunctions } from "../../utils/is-outside-all-functions.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getCallExpr, getDownstreamRefs, getRef, getUpstreamRefs } from "./utils/effect/ast.js";
import { getProgramAnalysis, type ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  findContainingNode,
  getEffectDepsRefs,
  getEffectFn,
  getEffectFnRefs,
  getUseStateDecl,
  isCustomHook,
  isProp,
  isRefCurrent,
  isState,
  isSyncStateSetterCall,
} from "./utils/effect/react.js";
import { getStaticMemberPropertyName } from "./utils/static-member-property-name.js";

// 1:1 port of upstream `src/rules/no-reset-all-state-on-prop-change.js`.

interface LivePropExpressionIdentity {
  propSymbolId: number;
  memberPath: string[];
  booleanNormalization: "identity" | "normalized" | "negated";
}

interface BooleanFormula {
  kind: "and" | "atom" | "constant" | "not" | "or";
  atomKey?: string;
  constantValue?: boolean;
  left?: BooleanFormula;
  right?: BooleanFormula;
}

interface BooleanFacts {
  assignments: Map<string, boolean>;
  didConflict: boolean;
  didChange: boolean;
}

const SYNCHRONOUS_ARRAY_CALLBACK_METHOD_NAMES = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some",
]);

const createConstantFormula = (constantValue: boolean): BooleanFormula => ({
  kind: "constant",
  constantValue,
});

const createNotFormula = (formula: BooleanFormula): BooleanFormula => ({
  kind: "not",
  left: formula,
});

const createBinaryFormula = (
  kind: "and" | "or",
  left: BooleanFormula,
  right: BooleanFormula,
): BooleanFormula => ({ kind, left, right });

const isUndefinedNode = (node: EsTreeNode | null | undefined): boolean => {
  if (node === null || node === undefined) return true;
  return isNodeOfType(node, "Identifier") && node.name === "undefined";
};

const getNodeText = (node: EsTreeNode | null | undefined): string => {
  if (!node) return "";
  return JSON.stringify(node, (key, value) => {
    if (key === "parent" || key === "loc" || key === "range" || key === "start" || key === "end") {
      return undefined;
    }
    return value;
  });
};

const normalizeAsBoolean = (identity: LivePropExpressionIdentity): LivePropExpressionIdentity => ({
  ...identity,
  booleanNormalization:
    identity.booleanNormalization === "identity" ? "normalized" : identity.booleanNormalization,
});

const negateBoolean = (identity: LivePropExpressionIdentity): LivePropExpressionIdentity => ({
  ...identity,
  booleanNormalization: identity.booleanNormalization === "negated" ? "normalized" : "negated",
});

const getLivePropExpressionIdentity = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  node: EsTreeNode,
  visitedSymbolIds: Set<number> = new Set(),
): LivePropExpressionIdentity | null => {
  const expression = stripParenExpression(node);

  if (isNodeOfType(expression, "Identifier")) {
    const reference = getRef(analysis, expression);
    const symbol = context.scopes.symbolFor(expression);
    if (!reference || !symbol) return null;
    if (isProp(analysis, reference)) {
      return {
        propSymbolId: symbol.id,
        memberPath: [],
        booleanNormalization: "identity",
      };
    }
    if (visitedSymbolIds.has(symbol.id) || symbol.kind !== "const") return null;
    visitedSymbolIds.add(symbol.id);
    const initializer = getDirectConstInitializer(symbol);
    if (initializer) {
      return getLivePropExpressionIdentity(analysis, context, initializer, visitedSymbolIds);
    }
    const hasPropSource = getUpstreamRefs(analysis, reference).some((upstreamReference) =>
      isProp(analysis, upstreamReference),
    );
    return hasPropSource
      ? {
          propSymbolId: symbol.id,
          memberPath: [],
          booleanNormalization: "identity",
        }
      : null;
  }

  if (isNodeOfType(expression, "MemberExpression")) {
    const propertyName = getStaticMemberPropertyName(expression);
    if (!propertyName) return null;
    const objectIdentity = getLivePropExpressionIdentity(
      analysis,
      context,
      expression.object as EsTreeNode,
      visitedSymbolIds,
    );
    if (!objectIdentity) return null;
    return {
      ...objectIdentity,
      memberPath: [...objectIdentity.memberPath, propertyName],
    };
  }

  if (
    isNodeOfType(expression, "CallExpression") &&
    isNodeOfType(expression.callee, "Identifier") &&
    expression.callee.name === "Boolean" &&
    context.scopes.isGlobalReference(expression.callee) &&
    expression.arguments?.length === 1
  ) {
    const argument = expression.arguments[0] as EsTreeNode;
    const argumentIdentity = getLivePropExpressionIdentity(
      analysis,
      context,
      argument,
      visitedSymbolIds,
    );
    return argumentIdentity ? normalizeAsBoolean(argumentIdentity) : null;
  }

  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") {
    const argumentIdentity = getLivePropExpressionIdentity(
      analysis,
      context,
      expression.argument as EsTreeNode,
      visitedSymbolIds,
    );
    return argumentIdentity ? negateBoolean(argumentIdentity) : null;
  }

  return null;
};

const getLivePropAtomKey = (identity: LivePropExpressionIdentity): string =>
  `prop:${identity.propSymbolId}:${JSON.stringify(identity.memberPath)}:${identity.booleanNormalization}`;

const getBooleanFormula = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  node: EsTreeNode,
  protectedSymbolIds: ReadonlySet<number>,
  visitedSymbolIds: Set<number> = new Set(),
): BooleanFormula | null => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal")) {
    return createConstantFormula(Boolean(expression.value));
  }
  if (isNodeOfType(expression, "Identifier")) {
    if (expression.name === "undefined" && context.scopes.isGlobalReference(expression)) {
      return createConstantFormula(false);
    }
    const symbol = context.scopes.symbolFor(expression);
    if (!symbol) return null;
    if (
      !protectedSymbolIds.has(symbol.id) &&
      symbol.kind === "const" &&
      !visitedSymbolIds.has(symbol.id) &&
      isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
      symbol.declarationNode.id === symbol.bindingIdentifier
    ) {
      const initializer = getDirectConstInitializer(symbol);
      if (initializer) {
        visitedSymbolIds.add(symbol.id);
        const initializerFormula = getBooleanFormula(
          analysis,
          context,
          initializer,
          protectedSymbolIds,
          visitedSymbolIds,
        );
        if (initializerFormula) return initializerFormula;
      }
    }
    return { kind: "atom", atomKey: `symbol:${symbol.id}` };
  }
  if (isNodeOfType(expression, "MemberExpression")) {
    const identity = getLivePropExpressionIdentity(analysis, context, expression);
    return identity ? { kind: "atom", atomKey: getLivePropAtomKey(identity) } : null;
  }
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") {
    const argumentFormula = getBooleanFormula(
      analysis,
      context,
      expression.argument as EsTreeNode,
      protectedSymbolIds,
      visitedSymbolIds,
    );
    return argumentFormula ? createNotFormula(argumentFormula) : null;
  }
  if (
    isNodeOfType(expression, "CallExpression") &&
    isNodeOfType(expression.callee, "Identifier") &&
    expression.callee.name === "Boolean" &&
    context.scopes.isGlobalReference(expression.callee) &&
    expression.arguments.length === 1 &&
    !isNodeOfType(expression.arguments[0], "SpreadElement")
  ) {
    return getBooleanFormula(
      analysis,
      context,
      expression.arguments[0],
      protectedSymbolIds,
      visitedSymbolIds,
    );
  }
  if (
    isNodeOfType(expression, "LogicalExpression") &&
    (expression.operator === "&&" || expression.operator === "||")
  ) {
    const leftFormula = getBooleanFormula(
      analysis,
      context,
      expression.left,
      protectedSymbolIds,
      new Set(visitedSymbolIds),
    );
    const rightFormula = getBooleanFormula(
      analysis,
      context,
      expression.right,
      protectedSymbolIds,
      new Set(visitedSymbolIds),
    );
    if (!leftFormula || !rightFormula) return null;
    return createBinaryFormula(
      expression.operator === "&&" ? "and" : "or",
      leftFormula,
      rightFormula,
    );
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    const testFormula = getBooleanFormula(
      analysis,
      context,
      expression.test,
      protectedSymbolIds,
      new Set(visitedSymbolIds),
    );
    const consequentFormula = getBooleanFormula(
      analysis,
      context,
      expression.consequent,
      protectedSymbolIds,
      new Set(visitedSymbolIds),
    );
    const alternateFormula = getBooleanFormula(
      analysis,
      context,
      expression.alternate,
      protectedSymbolIds,
      new Set(visitedSymbolIds),
    );
    if (!testFormula || !consequentFormula || !alternateFormula) return null;
    return createBinaryFormula(
      "or",
      createBinaryFormula("and", testFormula, consequentFormula),
      createBinaryFormula("and", createNotFormula(testFormula), alternateFormula),
    );
  }
  if (
    isNodeOfType(expression, "BinaryExpression") &&
    (expression.operator === "===" ||
      expression.operator === "==" ||
      expression.operator === "!==" ||
      expression.operator === "!=")
  ) {
    const leftIsBoolean =
      isNodeOfType(expression.left, "Literal") && typeof expression.left.value === "boolean";
    const rightIsBoolean =
      isNodeOfType(expression.right, "Literal") && typeof expression.right.value === "boolean";
    if (leftIsBoolean === rightIsBoolean) return null;
    const booleanLiteral = leftIsBoolean ? expression.left : expression.right;
    const comparedExpression = leftIsBoolean ? expression.right : expression.left;
    const comparedFormula = getBooleanFormula(
      analysis,
      context,
      comparedExpression,
      protectedSymbolIds,
      visitedSymbolIds,
    );
    if (!comparedFormula || !isNodeOfType(booleanLiteral, "Literal")) return null;
    const expectedEquality =
      expression.operator === "===" || expression.operator === "=="
        ? booleanLiteral.value
        : !booleanLiteral.value;
    return expectedEquality ? comparedFormula : createNotFormula(comparedFormula);
  }
  return null;
};

const getRequiredTruthyConditions = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  node: EsTreeNode,
  protectedSymbolIds: ReadonlySet<number>,
): BooleanFormula[] => {
  const formula = getBooleanFormula(analysis, context, node, protectedSymbolIds);
  if (formula) return [formula];
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "LogicalExpression") || expression.operator !== "&&") {
    return [];
  }
  return [
    ...getRequiredTruthyConditions(analysis, context, expression.left, protectedSymbolIds),
    ...getRequiredTruthyConditions(analysis, context, expression.right, protectedSymbolIds),
  ];
};

const evaluateBooleanFormula = (
  formula: BooleanFormula,
  assignments: ReadonlyMap<string, boolean>,
): boolean | null => {
  if (formula.kind === "constant") return formula.constantValue ?? null;
  if (formula.kind === "atom") {
    return formula.atomKey === undefined ? null : (assignments.get(formula.atomKey) ?? null);
  }
  if (formula.kind === "not") {
    if (!formula.left) return null;
    const value = evaluateBooleanFormula(formula.left, assignments);
    return value === null ? null : !value;
  }
  if (!formula.left || !formula.right) return null;
  const leftValue = evaluateBooleanFormula(formula.left, assignments);
  const rightValue = evaluateBooleanFormula(formula.right, assignments);
  if (formula.kind === "and") {
    if (leftValue === false || rightValue === false) return false;
    return leftValue === true && rightValue === true ? true : null;
  }
  if (leftValue === true || rightValue === true) return true;
  return leftValue === false && rightValue === false ? false : null;
};

const assignBooleanFact = (facts: BooleanFacts, atomKey: string, value: boolean): void => {
  const existingValue = facts.assignments.get(atomKey);
  if (existingValue === undefined) {
    facts.assignments.set(atomKey, value);
    facts.didChange = true;
  } else if (existingValue !== value) {
    facts.didConflict = true;
  }
};

const addRequiredBooleanFacts = (
  formula: BooleanFormula,
  expectedValue: boolean,
  facts: BooleanFacts,
): void => {
  const existingValue = evaluateBooleanFormula(formula, facts.assignments);
  if (existingValue !== null) {
    if (existingValue !== expectedValue) facts.didConflict = true;
    return;
  }
  if (formula.kind === "atom" && formula.atomKey !== undefined) {
    assignBooleanFact(facts, formula.atomKey, expectedValue);
    return;
  }
  if (formula.kind === "not" && formula.left) {
    addRequiredBooleanFacts(formula.left, !expectedValue, facts);
    return;
  }
  if (!formula.left || !formula.right) return;
  if (formula.kind === "and") {
    if (expectedValue) {
      addRequiredBooleanFacts(formula.left, true, facts);
      addRequiredBooleanFacts(formula.right, true, facts);
      return;
    }
    const leftValue = evaluateBooleanFormula(formula.left, facts.assignments);
    const rightValue = evaluateBooleanFormula(formula.right, facts.assignments);
    if (leftValue === true) addRequiredBooleanFacts(formula.right, false, facts);
    if (rightValue === true) addRequiredBooleanFacts(formula.left, false, facts);
    return;
  }
  if (!expectedValue) {
    addRequiredBooleanFacts(formula.left, false, facts);
    addRequiredBooleanFacts(formula.right, false, facts);
    return;
  }
  const leftValue = evaluateBooleanFormula(formula.left, facts.assignments);
  const rightValue = evaluateBooleanFormula(formula.right, facts.assignments);
  if (leftValue === false) addRequiredBooleanFacts(formula.right, true, facts);
  if (rightValue === false) addRequiredBooleanFacts(formula.left, true, facts);
};

const doConditionsImplyFormula = (
  conditions: ReadonlyArray<BooleanFormula>,
  target: BooleanFormula,
): boolean => {
  const facts: BooleanFacts = {
    assignments: new Map(),
    didConflict: false,
    didChange: true,
  };
  while (facts.didChange && !facts.didConflict) {
    facts.didChange = false;
    for (const condition of conditions) addRequiredBooleanFacts(condition, true, facts);
  }
  return facts.didConflict || evaluateBooleanFormula(target, facts.assignments) === true;
};

const getFunctionBindingSymbol = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  if (isNodeOfType(functionNode, "FunctionDeclaration") && functionNode.id) {
    return scopes.symbolFor(functionNode.id);
  }
  const parent = functionNode.parent;
  if (
    (isNodeOfType(functionNode, "ArrowFunctionExpression") ||
      isNodeOfType(functionNode, "FunctionExpression")) &&
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === functionNode &&
    isNodeOfType(parent.id, "Identifier")
  ) {
    return scopes.symbolFor(parent.id);
  }
  return null;
};

const getComponentFunctionNode = (containingNode: EsTreeNode): EsTreeNode | null => {
  if (isFunctionLike(containingNode)) return containingNode;
  if (!isNodeOfType(containingNode, "VariableDeclarator") || !containingNode.init) return null;
  const initializer = stripParenExpression(containingNode.init);
  if (isFunctionLike(initializer)) return initializer;
  if (!isNodeOfType(initializer, "CallExpression")) return null;
  const firstArgument = initializer.arguments[0];
  return firstArgument &&
    !isNodeOfType(firstArgument, "SpreadElement") &&
    isFunctionLike(firstArgument)
    ? firstArgument
    : null;
};

const isReferenceDirectlyCalled = (identifier: EsTreeNode): EsTreeNode | null => {
  const unwrappedIdentifier = stripParenExpression(identifier);
  const parent = unwrappedIdentifier.parent;
  return isNodeOfType(parent, "CallExpression") && parent.callee === unwrappedIdentifier
    ? parent
    : null;
};

const getSynchronousCallbackCall = (functionNode: EsTreeNode): EsTreeNode | null => {
  const callExpression = functionNode.parent;
  if (
    !isNodeOfType(callExpression, "CallExpression") ||
    !callExpression.arguments.some((argument) => argument === functionNode) ||
    !isNodeOfType(callExpression.callee, "MemberExpression")
  ) {
    return null;
  }
  const methodName = getStaticMemberPropertyName(callExpression.callee);
  return methodName && SYNCHRONOUS_ARRAY_CALLBACK_METHOD_NAMES.has(methodName)
    ? callExpression
    : null;
};

const isNodeEvaluatedDuringRender = (
  node: EsTreeNode,
  componentNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedFunctionSymbolIds: Set<number> = new Set(),
): boolean => {
  const functionNode = findEnclosingFunction(node);
  if (!functionNode) return false;
  if (functionNode === componentNode) return true;
  const synchronousCallbackCall = getSynchronousCallbackCall(functionNode);
  if (synchronousCallbackCall) {
    return isNodeEvaluatedDuringRender(
      synchronousCallbackCall,
      componentNode,
      scopes,
      visitedFunctionSymbolIds,
    );
  }
  if (executesDuringRender(functionNode, scopes)) {
    return isNodeEvaluatedDuringRender(
      functionNode.parent ?? functionNode,
      componentNode,
      scopes,
      visitedFunctionSymbolIds,
    );
  }
  const functionSymbol = getFunctionBindingSymbol(functionNode, scopes);
  if (!functionSymbol || visitedFunctionSymbolIds.has(functionSymbol.id)) return false;
  visitedFunctionSymbolIds.add(functionSymbol.id);
  let callCount = 0;
  for (const reference of functionSymbol.references) {
    const callExpression = isReferenceDirectlyCalled(reference.identifier);
    if (!callExpression) return false;
    if (
      !isNodeEvaluatedDuringRender(
        callExpression,
        componentNode,
        scopes,
        new Set(visitedFunctionSymbolIds),
      )
    ) {
      return false;
    }
    callCount += 1;
  }
  return callCount > 0;
};

const isInlineJsxCallback = (functionNode: EsTreeNode): boolean => {
  let ancestor: EsTreeNode | null | undefined = functionNode.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXAttribute")) return true;
    if (isFunctionLike(ancestor) || isNodeOfType(ancestor, "Program")) return false;
    ancestor = ancestor.parent;
  }
  return false;
};

const collectExposureConditions = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  node: EsTreeNode,
  componentNode: EsTreeNode,
  protectedSymbolIds: ReadonlySet<number>,
): BooleanFormula[] => {
  const conditions: BooleanFormula[] = [];
  let child: EsTreeNode = node;
  let parent: EsTreeNode | null | undefined = node.parent;
  while (parent) {
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === child) {
      if (parent.operator === "&&") {
        conditions.push(
          ...getRequiredTruthyConditions(analysis, context, parent.left, protectedSymbolIds),
        );
      }
      if (parent.operator === "||") {
        const leftFormula = getBooleanFormula(analysis, context, parent.left, protectedSymbolIds);
        if (leftFormula) conditions.push(createNotFormula(leftFormula));
      }
    } else if (isNodeOfType(parent, "ConditionalExpression")) {
      const testFormula = getBooleanFormula(analysis, context, parent.test, protectedSymbolIds);
      if (testFormula && parent.consequent === child) conditions.push(testFormula);
      if (testFormula && parent.alternate === child) conditions.push(createNotFormula(testFormula));
    } else if (isNodeOfType(parent, "IfStatement")) {
      const testFormula = getBooleanFormula(analysis, context, parent.test, protectedSymbolIds);
      if (testFormula && parent.consequent === child) conditions.push(testFormula);
      if (testFormula && parent.alternate === child) conditions.push(createNotFormula(testFormula));
    }
    if (parent === componentNode) break;
    if (isFunctionLike(parent) && parent !== componentNode && !isInlineJsxCallback(parent)) {
      const synchronousCallbackCall = getSynchronousCallbackCall(parent);
      if (synchronousCallbackCall) {
        child = synchronousCallbackCall;
        parent = synchronousCallbackCall.parent;
        continue;
      }
      const functionSymbol = getFunctionBindingSymbol(parent, context.scopes);
      if (functionSymbol?.references.length === 1) {
        const callExpression = isReferenceDirectlyCalled(functionSymbol.references[0].identifier);
        if (callExpression) {
          child = callExpression;
          parent = callExpression.parent;
          continue;
        }
      }
      break;
    }
    child = parent;
    parent = parent.parent;
  }
  return conditions;
};

const isMountSnapshotInitializer = (context: RuleContext, node: EsTreeNode): boolean => {
  if (
    !isReactApiCall(node, "useMemo", context.scopes, {
      resolveNamedAliases: true,
    }) ||
    !isNodeOfType(node, "CallExpression")
  ) {
    return false;
  }
  const dependencies = node.arguments?.[1];
  return isNodeOfType(dependencies, "ArrayExpression") && dependencies.elements.length === 0;
};

const isMountSnapshotBinding = (
  context: RuleContext,
  identifier: EsTreeNode,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const symbol = context.scopes.symbolFor(identifier);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  const initializer = getDirectConstInitializer(symbol);
  if (!initializer) return false;
  if (isMountSnapshotInitializer(context, initializer)) return true;
  const expression = stripParenExpression(initializer);
  return (
    isNodeOfType(expression, "Identifier") &&
    isMountSnapshotBinding(context, expression, visitedSymbolIds)
  );
};

const isConstantBooleanExpression = (
  context: RuleContext,
  node: EsTreeNode,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal")) return true;
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = context.scopes.symbolFor(expression);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    visitedSymbolIds.add(symbol.id);
    const initializer = getDirectConstInitializer(symbol);
    return Boolean(
      initializer && isConstantBooleanExpression(context, initializer, visitedSymbolIds),
    );
  }
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") {
    return isConstantBooleanExpression(
      context,
      expression.argument as EsTreeNode,
      visitedSymbolIds,
    );
  }
  if (
    isNodeOfType(expression, "CallExpression") &&
    isNodeOfType(expression.callee, "Identifier") &&
    expression.callee.name === "Boolean" &&
    context.scopes.isGlobalReference(expression.callee) &&
    expression.arguments?.length === 1
  ) {
    return isConstantBooleanExpression(
      context,
      expression.arguments[0] as EsTreeNode,
      visitedSymbolIds,
    );
  }
  return false;
};

const isProvenLiveBinding = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  identifier: EsTreeNode,
): boolean => {
  const reference = getRef(analysis, identifier);
  const symbol = context.scopes.symbolFor(identifier);
  if (!reference || !symbol || symbol.kind !== "const" || isOutsideAllFunctions(symbol)) {
    return false;
  }
  const initializer = symbol.initializer;
  if (!initializer || isMountSnapshotBinding(context, identifier)) return false;
  const initializerReferences = getDownstreamRefs(analysis, initializer);
  if (initializerReferences.some((initializerReference) => isRefCurrent(initializerReference))) {
    return false;
  }
  return !isConstantBooleanExpression(context, initializer);
};

const areSameProvenLiveBinding = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  left: EsTreeNode,
  right: EsTreeNode,
): boolean => {
  const leftExpression = stripParenExpression(left);
  const rightExpression = stripParenExpression(right);
  if (!isNodeOfType(leftExpression, "Identifier") || !isNodeOfType(rightExpression, "Identifier")) {
    return false;
  }
  const leftSymbol = context.scopes.symbolFor(leftExpression);
  const rightSymbol = context.scopes.symbolFor(rightExpression);
  return Boolean(
    leftSymbol &&
    leftSymbol === rightSymbol &&
    isProvenLiveBinding(analysis, context, leftExpression),
  );
};

const haveSameLivePropExpressionIdentity = (
  left: LivePropExpressionIdentity,
  right: LivePropExpressionIdentity,
): boolean => {
  if (
    left.propSymbolId !== right.propSymbolId ||
    left.booleanNormalization !== right.booleanNormalization ||
    left.memberPath.length !== right.memberPath.length
  ) {
    return false;
  }
  return left.memberPath.every((propertyName, index) => propertyName === right.memberPath[index]);
};

const isSetStateToInitialValue = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  setterRef: Reference,
): boolean => {
  const callExpr = getCallExpr(setterRef);
  if (!callExpr || !isNodeOfType(callExpr, "CallExpression")) return false;
  const setStateToValue: EsTreeNode | undefined = callExpr.arguments?.[0] as EsTreeNode | undefined;
  const useStateDecl = getUseStateDecl(analysis, setterRef);
  if (!useStateDecl || !isNodeOfType(useStateDecl, "VariableDeclarator")) return false;
  if (!isNodeOfType(useStateDecl.init, "CallExpression")) return false;
  const stateInitialValue = useStateDecl.init.arguments?.[0] as EsTreeNode | undefined;

  if (isUndefinedNode(setStateToValue) && isUndefinedNode(stateInitialValue)) return true;
  if (setStateToValue == null && stateInitialValue == null) return true;
  if ((setStateToValue && !stateInitialValue) || (!setStateToValue && stateInitialValue)) {
    return false;
  }
  if (stateInitialValue && setStateToValue) {
    const initialLivePropIdentity = getLivePropExpressionIdentity(
      analysis,
      context,
      stateInitialValue,
    );
    const nextLivePropIdentity = getLivePropExpressionIdentity(analysis, context, setStateToValue);
    if (
      initialLivePropIdentity &&
      nextLivePropIdentity &&
      haveSameLivePropExpressionIdentity(initialLivePropIdentity, nextLivePropIdentity)
    ) {
      return false;
    }
    if (areSameProvenLiveBinding(analysis, context, stateInitialValue, setStateToValue)) {
      return false;
    }
  }
  return getNodeText(setStateToValue) === getNodeText(stateInitialValue);
};

const countUseStates = (analysis: ProgramAnalysis, componentNode: EsTreeNode | null): number => {
  if (!componentNode) return 0;
  const stateVariables = new Set<Reference["resolved"]>();
  for (const ref of getDownstreamRefs(analysis, componentNode)) {
    if (isState(analysis, ref)) stateVariables.add(ref.resolved);
  }
  return stateVariables.size;
};

const hasUnconditionalAwaitBefore = (
  functionNode: EsTreeNode,
  boundaryNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  const boundaryStart = getRangeStart(boundaryNode);
  if (boundaryStart === null) return false;
  let didFindAwait = false;
  walkAst(functionNode, (child) => {
    if (didFindAwait) return false;
    if (child !== functionNode && isFunctionLike(child)) return false;
    if (
      !isNodeOfType(child, "AwaitExpression") ||
      !isNodeReachableWithinFunction(child, context) ||
      !context.cfg.isUnconditionalFromEntry(child)
    ) {
      return;
    }
    const awaitStart = getRangeStart(child);
    if (awaitStart !== null && awaitStart < boundaryStart) {
      didFindAwait = true;
      return false;
    }
  });
  return didFindAwait;
};

const helperReloadsSetterAfterAwait = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  helperFunction: EsTreeNode,
  setterReference: Reference,
): boolean =>
  getDownstreamRefs(analysis, helperFunction).some((helperReference) => {
    if (!setterReference.resolved || helperReference.resolved !== setterReference.resolved) {
      return false;
    }
    const helperSetterCall = getCallExpr(helperReference);
    return Boolean(
      helperSetterCall &&
      findEnclosingFunction(helperSetterCall) === helperFunction &&
      isNodeReachableWithinFunction(helperSetterCall, context) &&
      hasUnconditionalAwaitBefore(helperFunction, helperSetterCall, context),
    );
  });

const effectInvokesAsyncSetterReloadHelper = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  effectReferences: ReadonlyArray<Reference>,
  effectFunction: EsTreeNode,
  setterReference: Reference,
): boolean =>
  effectReferences.some((effectReference) => {
    const helperCall = getCallExpr(effectReference);
    if (
      !isNodeOfType(helperCall, "CallExpression") ||
      findEnclosingFunction(helperCall) !== effectFunction ||
      !isNodeReachableWithinFunction(helperCall, context)
    ) {
      return false;
    }
    const helperFunction = resolveExactLocalFunction(helperCall.callee, context.scopes);
    return Boolean(
      helperFunction &&
      helperFunction !== effectFunction &&
      helperReloadsSetterAfterAwait(analysis, context, helperFunction, setterReference),
    );
  });

const getStateSymbolForSetter = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  setterReference: Reference,
): SymbolDescriptor | null => {
  const useStateDeclaration = getUseStateDecl(analysis, setterReference);
  if (
    !useStateDeclaration ||
    !isNodeOfType(useStateDeclaration, "VariableDeclarator") ||
    !isNodeOfType(useStateDeclaration.id, "ArrayPattern")
  ) {
    return null;
  }
  const stateBinding = useStateDeclaration.id.elements[0];
  return stateBinding && isNodeOfType(stateBinding, "Identifier")
    ? context.scopes.symbolFor(stateBinding)
    : null;
};

const getPropertyName = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "Identifier")) return node.name;
  return isNodeOfType(node, "Literal") && typeof node.value === "string" ? node.value : null;
};

const isBooleanTypeNode = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  if (isNodeOfType(node, "TSBooleanKeyword")) return true;
  if (!isNodeOfType(node, "TSUnionType")) return false;
  return node.types.every(
    (typeNode) =>
      isNodeOfType(typeNode, "TSBooleanKeyword") ||
      isNodeOfType(typeNode, "TSUndefinedKeyword") ||
      isNodeOfType(typeNode, "TSNullKeyword"),
  );
};

const getBooleanPropertyType = (
  typeNode: EsTreeNode,
  propertyName: string,
  referenceNode: EsTreeNode,
): boolean => {
  const unwrappedType = isNodeOfType(typeNode, "TSTypeAnnotation")
    ? typeNode.typeAnnotation
    : typeNode;
  if (isNodeOfType(unwrappedType, "TSTypeLiteral")) {
    return unwrappedType.members.some(
      (member) =>
        isNodeOfType(member, "TSPropertySignature") &&
        getPropertyName(member.key) === propertyName &&
        isBooleanTypeNode(member.typeAnnotation?.typeAnnotation),
    );
  }
  if (
    !isNodeOfType(unwrappedType, "TSTypeReference") ||
    !isNodeOfType(unwrappedType.typeName, "Identifier")
  ) {
    return false;
  }
  const typeName = unwrappedType.typeName.name;
  if (hasEnclosingTypeParameterNamed(referenceNode, typeName)) return false;
  const programNode = findProgramNode(referenceNode);
  if (!isNodeOfType(programNode, "Program")) return false;
  const matchingInterfaces = programNode.body.flatMap((statement) => {
    const declaration = isNodeOfType(statement, "ExportNamedDeclaration")
      ? statement.declaration
      : statement;
    return isNodeOfType(declaration, "TSInterfaceDeclaration") && declaration.id.name === typeName
      ? [declaration]
      : [];
  });
  if (matchingInterfaces.length !== 1) return false;
  let sameNameTypeBindingCount = 0;
  walkAst(programNode, (candidate) => {
    const identifier =
      isNodeOfType(candidate, "TSInterfaceDeclaration") ||
      isNodeOfType(candidate, "TSTypeAliasDeclaration") ||
      isNodeOfType(candidate, "ClassDeclaration") ||
      isNodeOfType(candidate, "ClassExpression") ||
      isNodeOfType(candidate, "TSEnumDeclaration")
        ? candidate.id
        : isNodeOfType(candidate, "TSTypeParameter")
          ? candidate.name
          : null;
    if (isNodeOfType(identifier, "Identifier") && identifier.name === typeName) {
      sameNameTypeBindingCount += 1;
    }
  });
  if (sameNameTypeBindingCount !== 1) return false;
  return matchingInterfaces[0].body.body.some(
    (member) =>
      isNodeOfType(member, "TSPropertySignature") &&
      getPropertyName(member.key) === propertyName &&
      isBooleanTypeNode(member.typeAnnotation?.typeAnnotation),
  );
};

const findProgramNode = (node: EsTreeNode): EsTreeNode => {
  let currentNode = node;
  while (currentNode.parent) currentNode = currentNode.parent;
  return currentNode;
};

const hasBooleanBindingAnnotation = (symbol: SymbolDescriptor, identifier: EsTreeNode): boolean => {
  const bindingIdentifier = symbol.bindingIdentifier;
  const property = bindingIdentifier.parent;
  const objectPattern = property?.parent;
  if (
    !isNodeOfType(property, "Property") ||
    !isNodeOfType(objectPattern, "ObjectPattern") ||
    !objectPattern.typeAnnotation
  ) {
    return false;
  }
  const propertyName = getPropertyName(property.key);
  return Boolean(
    propertyName && getBooleanPropertyType(objectPattern.typeAnnotation, propertyName, identifier),
  );
};

const isBooleanExpression = (
  context: RuleContext,
  node: EsTreeNode,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal")) return typeof expression.value === "boolean";
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") return true;
  if (isNodeOfType(expression, "BinaryExpression")) {
    return ["==", "===", "!=", "!==", "<", "<=", ">", ">="].includes(expression.operator);
  }
  if (
    isNodeOfType(expression, "CallExpression") &&
    isNodeOfType(expression.callee, "Identifier") &&
    expression.callee.name === "Boolean" &&
    context.scopes.isGlobalReference(expression.callee)
  ) {
    return true;
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    return (
      isBooleanExpression(context, expression.left, new Set(visitedSymbolIds)) &&
      isBooleanExpression(context, expression.right, new Set(visitedSymbolIds))
    );
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    return (
      isBooleanExpression(context, expression.consequent, new Set(visitedSymbolIds)) &&
      isBooleanExpression(context, expression.alternate, new Set(visitedSymbolIds))
    );
  }
  if (!isNodeOfType(expression, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(expression);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  if (hasBooleanBindingAnnotation(symbol, expression)) return true;
  visitedSymbolIds.add(symbol.id);
  const initializer = getDirectConstInitializer(symbol);
  return Boolean(initializer && isBooleanExpression(context, initializer, visitedSymbolIds));
};

const getPropDerivedDependencySymbols = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  dependencyReferences: ReadonlyArray<Reference>,
): SymbolDescriptor[] => {
  const symbolsById = new Map<number, SymbolDescriptor>();
  for (const dependencyReference of dependencyReferences) {
    if (
      !getUpstreamRefs(analysis, dependencyReference).some((upstreamReference) =>
        isProp(analysis, upstreamReference),
      )
    ) {
      continue;
    }
    const symbol = context.scopes.symbolFor(
      dependencyReference.identifier as unknown as EsTreeNode,
    );
    if (symbol) symbolsById.set(symbol.id, symbol);
  }
  return [...symbolsById.values()];
};

const getImpliedDependencyValue = (
  conditions: ReadonlyArray<BooleanFormula>,
  dependencyFormulas: ReadonlyArray<BooleanFormula>,
): boolean | null => {
  const impliesTrue = dependencyFormulas.some((dependencyFormula) =>
    doConditionsImplyFormula(conditions, dependencyFormula),
  );
  const impliesFalse = dependencyFormulas.some((dependencyFormula) =>
    doConditionsImplyFormula(conditions, createNotFormula(dependencyFormula)),
  );
  if (impliesTrue === impliesFalse) return null;
  return impliesTrue;
};

const getSetterExposureConditions = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  setterReference: Reference,
  componentNode: EsTreeNode,
  protectedSymbolIds: ReadonlySet<number>,
): BooleanFormula[][] | null => {
  const functionNode = findEnclosingFunction(setterReference.identifier as unknown as EsTreeNode);
  if (!functionNode) return null;
  if (isInlineJsxCallback(functionNode)) {
    return [
      collectExposureConditions(analysis, context, functionNode, componentNode, protectedSymbolIds),
    ];
  }
  const functionSymbol = getFunctionBindingSymbol(functionNode, context.scopes);
  if (!functionSymbol || functionSymbol.references.length === 0) return null;
  const conditionsByReference: BooleanFormula[][] = [];
  for (const reference of functionSymbol.references) {
    if (isReferenceDirectlyCalled(reference.identifier)) return null;
    let ancestor: EsTreeNode | null | undefined = reference.identifier.parent;
    while (ancestor && !isNodeOfType(ancestor, "JSXAttribute") && !isFunctionLike(ancestor)) {
      ancestor = ancestor.parent;
    }
    if (!isNodeOfType(ancestor, "JSXAttribute")) return null;
    conditionsByReference.push(
      collectExposureConditions(
        analysis,
        context,
        reference.identifier,
        componentNode,
        protectedSymbolIds,
      ),
    );
  }
  return conditionsByReference;
};

const areAllSetterWritesVisibilityGuarded = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  componentNode: EsTreeNode,
  resetSetterReferences: ReadonlyArray<Reference>,
  dependencySymbolIds: ReadonlySet<number>,
  dependencyFormulas: ReadonlyArray<BooleanFormula>,
  visibleDependencyValue: boolean,
): boolean => {
  const resetIdentifiers = new Set(
    resetSetterReferences.map((setterReference) => setterReference.identifier),
  );
  const setterVariables = new Set(resetSetterReferences.map((reference) => reference.resolved));
  for (const setterVariable of setterVariables) {
    if (!setterVariable) return false;
    for (const setterReference of setterVariable.references) {
      if (
        setterVariable.identifiers.some((identifier) => identifier === setterReference.identifier)
      ) {
        continue;
      }
      if (resetIdentifiers.has(setterReference.identifier)) continue;
      const setterCall = getCallExpr(setterReference);
      if (!setterCall) return false;
      const conditionsByExposure = getSetterExposureConditions(
        analysis,
        context,
        setterReference,
        componentNode,
        dependencySymbolIds,
      );
      if (
        !conditionsByExposure ||
        conditionsByExposure.some(
          (conditions) =>
            getImpliedDependencyValue(conditions, dependencyFormulas) !== visibleDependencyValue,
        )
      ) {
        return false;
      }
    }
  }
  return true;
};

const areAllResetStateReadsHiddenUntilReset = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  componentNode: EsTreeNode,
  setterReferences: ReadonlyArray<Reference>,
  dependencyReferences: ReadonlyArray<Reference>,
): boolean => {
  if (dependencyReferences.length !== 1) return false;
  const dependencySymbols = getPropDerivedDependencySymbols(
    analysis,
    context,
    dependencyReferences,
  );
  if (
    dependencySymbols.length === 0 ||
    dependencySymbols.some(
      (symbol) =>
        !isBooleanExpression(context, symbol.bindingIdentifier) ||
        symbol.references.some((reference) => reference.flag !== "read"),
    )
  ) {
    return false;
  }
  const dependencySymbolIds = new Set(dependencySymbols.map((symbol) => symbol.id));
  const dependencyFormulas = dependencySymbols.map<BooleanFormula>((symbol) => ({
    kind: "atom",
    atomKey: `symbol:${symbol.id}`,
  }));
  const resetStateSymbolsById = new Map<number, SymbolDescriptor>();
  for (const setterReference of setterReferences) {
    const stateSymbol = getStateSymbolForSetter(analysis, context, setterReference);
    if (!stateSymbol) return false;
    resetStateSymbolsById.set(stateSymbol.id, stateSymbol);
  }
  let visibleDependencyValue: boolean | null = null;
  for (const stateSymbol of resetStateSymbolsById.values()) {
    let exposedReadCount = 0;
    for (const reference of stateSymbol.references) {
      if (reference.flag === "write") continue;
      const isRenderRead = isNodeEvaluatedDuringRender(
        reference.identifier,
        componentNode,
        context.scopes,
      );
      const functionNode = findEnclosingFunction(reference.identifier);
      if (!isRenderRead && functionNode && !isInlineJsxCallback(functionNode)) return false;
      const conditions = collectExposureConditions(
        analysis,
        context,
        reference.identifier,
        componentNode,
        dependencySymbolIds,
      );
      const referenceDependencyValue = getImpliedDependencyValue(conditions, dependencyFormulas);
      if (referenceDependencyValue === null) return false;
      if (visibleDependencyValue !== null && visibleDependencyValue !== referenceDependencyValue) {
        return false;
      }
      visibleDependencyValue = referenceDependencyValue;
      exposedReadCount += 1;
    }
    if (exposedReadCount === 0) return false;
  }
  return Boolean(
    resetStateSymbolsById.size > 0 &&
    visibleDependencyValue !== null &&
    areAllSetterWritesVisibilityGuarded(
      analysis,
      context,
      componentNode,
      setterReferences,
      dependencySymbolIds,
      dependencyFormulas,
      visibleDependencyValue,
    ),
  );
};

const findPropUsedToResetAllState = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  effectFnRefs: Reference[],
  depsRefs: Reference[],
  useEffectNode: EsTreeNode,
  effectFn: EsTreeNode,
): Reference | null => {
  // A setter that only runs inside a listener / observer / subscription
  // callback fires on that event, not when the prop changes — only
  // synchronous setter calls are the reset-on-prop-change shape.
  const stateSetterRefs = effectFnRefs.filter((ref) =>
    isSyncStateSetterCall(analysis, ref, effectFn),
  );
  if (stateSetterRefs.length === 0) return null;

  const allResetToInitial = stateSetterRefs.every((ref) =>
    isSetStateToInitialValue(analysis, context, ref),
  );
  if (!allResetToInitial) return null;

  // The sync reset is the loading phase of a fetch lifecycle when the SAME
  // state is set again from an async continuation inside this effect (the
  // real value arrives later; cleanup cancels stale requests) — freecut
  // inline-source-preview / inline-composition-preview in the delta audit.
  const isEveryResetReloadedAsync = stateSetterRefs.every(
    (setterRef) =>
      effectFnRefs.some(
        (otherRef) =>
          otherRef !== setterRef &&
          otherRef.resolved === setterRef.resolved &&
          Boolean(getCallExpr(otherRef)) &&
          !isSyncStateSetterCall(analysis, otherRef, effectFn),
      ) ||
      effectInvokesAsyncSetterReloadHelper(analysis, context, effectFnRefs, effectFn, setterRef),
  );
  if (isEveryResetReloadedAsync) return null;

  const containing = findContainingNode(analysis, useEffectNode);
  // Distinct state VARIABLES reset — two call sites of one setter must not
  // satisfy a two-useState component (freecut inline-composition-preview,
  // delta audit).
  const resetStateVariables = new Set(stateSetterRefs.map((setterRef) => setterRef.resolved));
  if (resetStateVariables.size !== countUseStates(analysis, containing)) return null;

  const componentFunctionNode = containing ? getComponentFunctionNode(containing) : null;
  if (
    componentFunctionNode &&
    areAllResetStateReadsHiddenUntilReset(
      analysis,
      context,
      componentFunctionNode,
      stateSetterRefs,
      depsRefs,
    )
  ) {
    return null;
  }

  for (const depRef of depsRefs) {
    for (const upRef of getUpstreamRefs(analysis, depRef)) {
      if (isProp(analysis, upRef)) return upRef;
    }
  }
  return null;
};

export const noResetAllStateOnPropChange = defineRule({
  id: "no-reset-all-state-on-prop-change",
  title: "All state reset on prop change",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Pass the prop as `key` so React resets the component for you when the prop changes, instead of clearing every state value by hand in a useEffect. See https://react.dev/learn/you-might-not-need-an-effect#resetting-all-state-when-a-prop-changes",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactHookCall(node, "useEffect", context.scopes)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      const effectFnRefs = getEffectFnRefs(analysis, node);
      const depsRefs = getEffectDepsRefs(analysis, node);
      if (!effectFnRefs || !depsRefs) return;
      const containing = findContainingNode(analysis, node);
      if (containing && isCustomHook(containing)) return;
      const effectFn = getEffectFn(analysis, node);
      if (!effectFn) return;

      const propUsedToReset = findPropUsedToResetAllState(
        analysis,
        context,
        effectFnRefs,
        depsRefs,
        node,
        effectFn,
      );
      if (!propUsedToReset) return;
      context.report({
        node,
        message: `Your users briefly see stale state when a prop changes because this useEffect clears all state.`,
      });
    },
  }),
});
