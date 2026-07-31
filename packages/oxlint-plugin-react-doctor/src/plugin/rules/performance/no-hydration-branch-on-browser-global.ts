import { EMPTY_RULE_VISITORS } from "../../utils/empty-rule-visitors.js";
import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import { REACT_RUNTIME_MODULE_SOURCES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { executesDuringRender } from "../../utils/executes-during-render.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findEnclosingJsxOpeningElement } from "../../utils/find-enclosing-jsx-opening-element.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { flattenJsxName } from "../../utils/flatten-jsx-name.js";
import { getDirectFunctionBindingIdentifier } from "../../utils/get-direct-function-binding-identifier.js";
import { hasClientRenderEvidence } from "../../utils/has-client-render-evidence.js";
import { hasDirective } from "../../utils/has-directive.js";
import { hasEmailTemplateImport } from "../../utils/has-email-template-import.js";
import { hasSuppressHydrationWarningAttribute } from "../../utils/has-suppress-hydration-warning-attribute.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isAfterClientOnlyEarlyReturn } from "../../utils/is-after-client-only-early-return.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isGatedByFalsyInitialState } from "../../utils/is-gated-by-falsy-initial-state.js";
import { isGeneratedImageRenderContext } from "../../utils/is-generated-image-render-context.js";
import { getNodeStartIndex } from "../../utils/get-node-start-index.js";
import { getResolvedStaticPropertyName } from "../../utils/get-resolved-static-property-name.js";
import { isEventHandlerAttribute } from "../../utils/is-event-handler-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { classifyReactNativeFileTarget } from "../../utils/is-react-native-file.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { readInitialStateBoolean } from "../../utils/read-initial-state-boolean.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { statementAlwaysExits } from "../../utils/statement-always-exits.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

interface BrowserPredicateMatch {
  readonly browserGlobalName: "window" | "document";
  readonly clientResult: boolean;
  readonly serverResult: boolean;
}

interface HydrationConditionMatch {
  readonly predicateMatch: BrowserPredicateMatch;
  readonly predicateNode: EsTreeNode;
}

interface HydrationResolutionState {
  readonly parameterValuesBySymbolId: Map<number, EsTreeNode>;
  readonly visitedFunctionNodes: Set<EsTreeNode>;
  readonly visitedSymbolIds: Set<number>;
}

interface HydrationStatementResult {
  readonly didReturn: boolean;
  readonly value: boolean | null;
}

interface HydrationPrimitiveResult {
  readonly kind: "boolean" | "null" | "number" | "string" | "undefined";
  readonly value: boolean | null | number | string | undefined;
}

interface ReturnedStatePath {
  readonly kind: "direct" | "index" | "property";
  readonly key: string | null;
}

const findGuardingIfStatements = (
  node: EsTreeNode,
  functionBoundary: EsTreeNode,
): ReadonlyArray<EsTreeNodeOfType<"IfStatement">> => {
  const guardingIfStatements: Array<EsTreeNodeOfType<"IfStatement">> = [];
  let currentNode = node.parent;
  while (currentNode && currentNode !== functionBoundary) {
    if (isNodeOfType(currentNode, "IfStatement")) guardingIfStatements.push(currentNode);
    currentNode = currentNode.parent;
  }
  return guardingIfStatements;
};

const doesNodeReadSymbol = (node: EsTreeNode, symbol: SymbolDescriptor): boolean => {
  let doesReadSymbol = false;
  walkAst(node, (childNode) => {
    if (
      isNodeOfType(childNode, "Identifier") &&
      symbol.references.some(
        (reference) => reference.identifier === childNode && reference.flag !== "write",
      )
    ) {
      doesReadSymbol = true;
      return false;
    }
  });
  return doesReadSymbol;
};

const collectWrittenSymbols = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlySet<SymbolDescriptor> => {
  const writtenSymbols = new Set<SymbolDescriptor>();
  walkAst(node, (childNode) => {
    if (childNode !== node && isFunctionLike(childNode)) return false;
    if (!isNodeOfType(childNode, "Identifier")) return;
    const reference = scopes.referenceFor(childNode);
    if (!reference || reference.flag === "read" || !reference.resolvedSymbol) return;
    writtenSymbols.add(reference.resolvedSymbol);
  });
  return writtenSymbols;
};

const isDescendantOf = (node: EsTreeNode, ancestorNode: EsTreeNode): boolean => {
  let currentNode = node.parent;
  while (currentNode) {
    if (currentNode === ancestorNode) return true;
    currentNode = currentNode.parent;
  }
  return false;
};

const getAssignedValue = (identifier: EsTreeNode): EsTreeNode | null => {
  const assignmentExpression = identifier.parent;
  return isNodeOfType(assignmentExpression, "AssignmentExpression") &&
    assignmentExpression.operator === "=" &&
    assignmentExpression.left === identifier
    ? assignmentExpression.right
    : null;
};

const doesGuardPreserveInitialSymbolValue = (
  symbol: SymbolDescriptor,
  guardingIfStatement: EsTreeNodeOfType<"IfStatement">,
  scopes: ScopeAnalysis,
): boolean => {
  const initialValue = symbol.initializer;
  if (!initialValue) return false;
  const guardedWrites = symbol.references.filter(
    (reference) =>
      reference.flag !== "read" && isDescendantOf(reference.identifier, guardingIfStatement),
  );
  return (
    guardedWrites.length > 0 &&
    guardedWrites.every((reference) => {
      const assignedValue = getAssignedValue(reference.identifier);
      return Boolean(
        assignedValue &&
        areExpressionsStructurallyEqual(initialValue, assignedValue) &&
        doEquivalentExpressionBindingsMatch(initialValue, assignedValue, scopes),
      );
    })
  );
};

const isWriteOverwrittenBefore = (
  symbol: SymbolDescriptor,
  writeIdentifier: EsTreeNode,
  guardingIfStatement: EsTreeNodeOfType<"IfStatement">,
  readIdentifier: EsTreeNode,
  context: RuleContext,
): boolean =>
  symbol.references.some(
    (reference) =>
      reference.flag !== "read" &&
      reference.identifier !== writeIdentifier &&
      !isDescendantOf(reference.identifier, guardingIfStatement) &&
      isNodeReachableWithinFunction(reference.identifier, context) &&
      isUnconditionalOrStaticallySelected(reference.identifier, context) &&
      getNodeStartIndex(reference.identifier) > getNodeStartIndex(writeIdentifier) &&
      getNodeStartIndex(reference.identifier) < getNodeStartIndex(readIdentifier),
  );

const isUnconditionalOrStaticallySelected = (node: EsTreeNode, context: RuleContext): boolean => {
  if (context.cfg.isUnconditionalFromEntry(node)) return true;
  let currentNode = node;
  let outermostStaticIfStatement: EsTreeNodeOfType<"IfStatement"> | null = null;
  let parentNode = currentNode.parent;
  while (parentNode) {
    if (isFunctionLike(parentNode)) break;
    if (isNodeOfType(parentNode, "IfStatement")) {
      const staticResult = readInitialStateBoolean(parentNode.test, context.scopes);
      let selectedBranch: EsTreeNode | null = null;
      if (staticResult === true) selectedBranch = parentNode.consequent;
      if (staticResult === false) selectedBranch = parentNode.alternate;
      if (
        !selectedBranch ||
        (currentNode !== selectedBranch && !isDescendantOf(currentNode, selectedBranch))
      ) {
        return false;
      }
      outermostStaticIfStatement = parentNode;
    }
    currentNode = parentNode;
    parentNode = currentNode.parent;
  }
  return Boolean(
    outermostStaticIfStatement && context.cfg.isUnconditionalFromEntry(outermostStaticIfStatement),
  );
};

const containsExplicitReactRuntimeReference = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let hasRuntimeReference = false;
  walkAst(node, (childNode) => {
    if (
      isNodeOfType(childNode, "ImportDeclaration") &&
      typeof childNode.source.value === "string" &&
      REACT_RUNTIME_MODULE_SOURCES.has(childNode.source.value)
    ) {
      hasRuntimeReference = true;
      return false;
    }
    if (!isNodeOfType(childNode, "CallExpression")) return;
    const callArguments = childNode.arguments ?? [];
    const sourceArgument = callArguments[0];
    if (
      !isNodeOfType(childNode.callee, "Identifier") ||
      childNode.callee.name !== "require" ||
      !scopes.isGlobalReference(childNode.callee) ||
      !isNodeOfType(sourceArgument, "Literal") ||
      typeof sourceArgument.value !== "string" ||
      !REACT_RUNTIME_MODULE_SOURCES.has(sourceArgument.value)
    ) {
      return;
    }
    hasRuntimeReference = true;
    return false;
  });
  return hasRuntimeReference;
};

const findComponentRenderingLocalFunctionResult = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const bindingIdentifier = getDirectFunctionBindingIdentifier(functionNode);
  if (!isNodeOfType(bindingIdentifier, "Identifier")) return null;
  const functionSymbol = scopes.symbolFor(bindingIdentifier);
  if (!functionSymbol) return null;
  for (const reference of functionSymbol.references) {
    const callExpression = reference.identifier.parent;
    if (
      !isNodeOfType(callExpression, "CallExpression") ||
      callExpression.callee !== reference.identifier
    ) {
      continue;
    }
    const componentOrHookNode = findRenderPhaseComponentOrHook(callExpression, scopes);
    if (componentOrHookNode && isInRenderedOutput(callExpression, componentOrHookNode, scopes)) {
      return componentOrHookNode;
    }
  }
  return null;
};

const evaluateEquality = (operator: string, left: string, right: string): boolean | null => {
  if (operator === "===" || operator === "==") return left === right;
  if (operator === "!==" || operator === "!=") return left !== right;
  return null;
};

const readTypeofBrowserGlobal = (
  expression: EsTreeNode,
  context: RuleContext,
): "window" | "document" | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    !isNodeOfType(unwrappedExpression, "UnaryExpression") ||
    unwrappedExpression.operator !== "typeof"
  ) {
    return null;
  }
  const argument = stripParenExpression(unwrappedExpression.argument);
  if (isNodeOfType(argument, "Identifier")) {
    return (argument.name === "window" || argument.name === "document") &&
      context.scopes.isGlobalReference(argument)
      ? argument.name
      : null;
  }
  if (
    !isNodeOfType(argument, "MemberExpression") ||
    argument.computed ||
    !isNodeOfType(argument.object, "Identifier") ||
    argument.object.name !== "globalThis" ||
    !context.scopes.isGlobalReference(argument.object) ||
    !isNodeOfType(argument.property, "Identifier") ||
    (argument.property.name !== "window" && argument.property.name !== "document")
  ) {
    return null;
  }
  return argument.property.name;
};

const matchBrowserPredicate = (
  expression: EsTreeNode,
  context: RuleContext,
): BrowserPredicateMatch | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "!"
  ) {
    const innerMatch = matchBrowserPredicate(unwrappedExpression.argument, context);
    return innerMatch
      ? {
          browserGlobalName: innerMatch.browserGlobalName,
          clientResult: !innerMatch.clientResult,
          serverResult: !innerMatch.serverResult,
        }
      : null;
  }
  if (!isNodeOfType(unwrappedExpression, "BinaryExpression")) return null;
  const leftGlobalName = readTypeofBrowserGlobal(unwrappedExpression.left, context);
  const rightGlobalName = readTypeofBrowserGlobal(unwrappedExpression.right, context);
  const leftString = isNodeOfType(unwrappedExpression.left, "Literal")
    ? unwrappedExpression.left.value
    : null;
  const rightString = isNodeOfType(unwrappedExpression.right, "Literal")
    ? unwrappedExpression.right.value
    : null;
  const browserGlobalName =
    leftGlobalName && typeof rightString === "string"
      ? leftGlobalName
      : rightGlobalName && typeof leftString === "string"
        ? rightGlobalName
        : null;
  const comparedType =
    leftGlobalName && typeof rightString === "string"
      ? rightString
      : rightGlobalName && typeof leftString === "string"
        ? leftString
        : null;
  if (!browserGlobalName || !comparedType) return null;
  const clientResult = evaluateEquality(unwrappedExpression.operator, "object", comparedType);
  const serverResult = evaluateEquality(unwrappedExpression.operator, "undefined", comparedType);
  if (clientResult === null || serverResult === null || clientResult === serverResult) return null;
  return { browserGlobalName, clientResult, serverResult };
};

const readLogicalConditionResult = (
  operator: "&&" | "||",
  leftResult: boolean | null,
  rightResult: boolean | null,
): boolean | null => {
  if (operator === "&&") {
    if (leftResult === false || rightResult === false) return false;
    if (leftResult === true && rightResult === true) return true;
    return null;
  }
  if (leftResult === true || rightResult === true) return true;
  if (leftResult === false && rightResult === false) return false;
  return null;
};

const areLooselyEqualPrimitiveResults = (
  left: HydrationPrimitiveResult,
  right: HydrationPrimitiveResult,
): boolean => {
  if (left.kind === right.kind) return left.value === right.value;
  if (
    (left.kind === "null" && right.kind === "undefined") ||
    (left.kind === "undefined" && right.kind === "null")
  ) {
    return true;
  }
  if (left.kind === "boolean") {
    return areLooselyEqualPrimitiveResults({ kind: "number", value: left.value ? 1 : 0 }, right);
  }
  if (right.kind === "boolean") {
    return areLooselyEqualPrimitiveResults(left, {
      kind: "number",
      value: right.value ? 1 : 0,
    });
  }
  if (left.kind === "number" && right.kind === "string") {
    return left.value === Number(right.value);
  }
  if (left.kind === "string" && right.kind === "number") {
    return Number(left.value) === right.value;
  }
  return false;
};

const readHydrationPrimitiveResult = (
  expression: EsTreeNode,
  context: RuleContext,
  runtime: "client" | "server",
  state: HydrationResolutionState,
): HydrationPrimitiveResult | null => {
  const unwrappedExpression = stripParenExpression(expression);
  const predicateMatch = matchBrowserPredicate(unwrappedExpression, context);
  if (predicateMatch) {
    return { kind: "boolean", value: predicateMatch[`${runtime}Result`] };
  }
  if (isNodeOfType(unwrappedExpression, "Literal")) {
    const value = unwrappedExpression.value;
    if (value === null) return { kind: "null", value };
    if (typeof value === "boolean") return { kind: "boolean", value };
    if (typeof value === "number") return { kind: "number", value };
    if (typeof value === "string") return { kind: "string", value };
    return null;
  }
  if (
    isNodeOfType(unwrappedExpression, "Identifier") &&
    unwrappedExpression.name === "undefined" &&
    context.scopes.isGlobalReference(unwrappedExpression)
  ) {
    return { kind: "undefined", value: undefined };
  }
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = context.scopes.symbolFor(unwrappedExpression);
    const parameterValue = symbol ? state.parameterValuesBySymbolId.get(symbol.id) : null;
    if (symbol && parameterValue && !state.visitedSymbolIds.has(symbol.id)) {
      state.visitedSymbolIds.add(symbol.id);
      const result = readHydrationPrimitiveResult(parameterValue, context, runtime, state);
      state.visitedSymbolIds.delete(symbol.id);
      return result;
    }
    if (
      symbol &&
      symbol.kind === "const" &&
      symbol.initializer &&
      symbol.references.every((reference) => reference.flag === "read") &&
      !state.visitedSymbolIds.has(symbol.id)
    ) {
      state.visitedSymbolIds.add(symbol.id);
      const result = readHydrationPrimitiveResult(symbol.initializer, context, runtime, state);
      state.visitedSymbolIds.delete(symbol.id);
      return result;
    }
  }
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "!"
  ) {
    const argumentResult = readHydrationConditionResult(
      unwrappedExpression.argument,
      context,
      runtime,
      state,
    );
    return argumentResult === null ? null : { kind: "boolean", value: !argumentResult };
  }
  if (isNodeOfType(unwrappedExpression, "BinaryExpression")) {
    const leftResult = readHydrationPrimitiveResult(
      unwrappedExpression.left,
      context,
      runtime,
      state,
    );
    const rightResult = readHydrationPrimitiveResult(
      unwrappedExpression.right,
      context,
      runtime,
      state,
    );
    if (!leftResult || !rightResult) return null;
    if (unwrappedExpression.operator === "===" || unwrappedExpression.operator === "!==") {
      const areEqual =
        leftResult.kind === rightResult.kind && leftResult.value === rightResult.value;
      return {
        kind: "boolean",
        value: unwrappedExpression.operator === "===" ? areEqual : !areEqual,
      };
    }
    if (unwrappedExpression.operator === "==" || unwrappedExpression.operator === "!=") {
      const areEqual = areLooselyEqualPrimitiveResults(leftResult, rightResult);
      return {
        kind: "boolean",
        value: unwrappedExpression.operator === "==" ? areEqual : !areEqual,
      };
    }
  }
  if (isNodeOfType(unwrappedExpression, "CallExpression")) {
    const callArguments = unwrappedExpression.arguments ?? [];
    const callee = stripParenExpression(unwrappedExpression.callee);
    if (
      isNodeOfType(callee, "Identifier") &&
      callee.name === "Boolean" &&
      context.scopes.isGlobalReference(callee) &&
      callArguments.length === 1 &&
      !isNodeOfType(callArguments[0], "SpreadElement")
    ) {
      const argumentResult = readHydrationConditionResult(
        callArguments[0],
        context,
        runtime,
        state,
      );
      return argumentResult === null ? null : { kind: "boolean", value: argumentResult };
    }
  }
  return null;
};

const readHydrationConditionResult = (
  expression: EsTreeNode,
  context: RuleContext,
  runtime: "client" | "server",
  state: HydrationResolutionState,
): boolean | null => {
  const unwrappedExpression = stripParenExpression(expression);
  const predicateMatch = matchBrowserPredicate(unwrappedExpression, context);
  if (predicateMatch) return predicateMatch[`${runtime}Result`];
  const staticResult = readInitialStateBoolean(unwrappedExpression, context.scopes);
  if (staticResult !== null) return staticResult;
  const expressionSymbol = isNodeOfType(unwrappedExpression, "Identifier")
    ? context.scopes.symbolFor(unwrappedExpression)
    : null;
  const parameterValue = expressionSymbol
    ? state.parameterValuesBySymbolId.get(expressionSymbol.id)
    : null;
  if (expressionSymbol && parameterValue && !state.visitedSymbolIds.has(expressionSymbol.id)) {
    state.visitedSymbolIds.add(expressionSymbol.id);
    const result = readHydrationConditionResult(parameterValue, context, runtime, state);
    state.visitedSymbolIds.delete(expressionSymbol.id);
    return result;
  }
  if (
    expressionSymbol &&
    expressionSymbol.kind === "const" &&
    expressionSymbol.initializer &&
    expressionSymbol.references.every((reference) => reference.flag === "read") &&
    !state.visitedSymbolIds.has(expressionSymbol.id)
  ) {
    state.visitedSymbolIds.add(expressionSymbol.id);
    const result = readHydrationConditionResult(
      expressionSymbol.initializer,
      context,
      runtime,
      state,
    );
    state.visitedSymbolIds.delete(expressionSymbol.id);
    return result;
  }
  if (isNodeOfType(unwrappedExpression, "CallExpression")) {
    const callArguments = unwrappedExpression.arguments ?? [];
    if (
      isReactApiCall(unwrappedExpression, "useMemo", context.scopes, {
        allowGlobalReactNamespace: true,
        resolveNamedAliases: true,
      })
    ) {
      const callbackArgument = callArguments[0];
      if (!callbackArgument || isNodeOfType(callbackArgument, "SpreadElement")) return null;
      const callbackFunction = resolveExactLocalFunction(callbackArgument, context.scopes);
      return isFunctionLike(callbackFunction) && callbackFunction.params.length === 0
        ? readHydrationFunctionResult(callbackFunction, context, runtime, state)
        : null;
    }
    const callee = stripParenExpression(unwrappedExpression.callee);
    if (
      isNodeOfType(callee, "Identifier") &&
      callee.name === "Boolean" &&
      context.scopes.isGlobalReference(callee) &&
      callArguments.length === 1 &&
      !isNodeOfType(callArguments[0], "SpreadElement")
    ) {
      return readHydrationConditionResult(callArguments[0], context, runtime, state);
    }
    const helperFunction = resolveExactLocalFunction(callee, context.scopes);
    if (
      !isFunctionLike(helperFunction) ||
      helperFunction.async ||
      (isNodeOfType(helperFunction, "FunctionDeclaration") && helperFunction.generator) ||
      (isNodeOfType(helperFunction, "FunctionExpression") && helperFunction.generator) ||
      helperFunction.params.some((parameter) => !isNodeOfType(parameter, "Identifier")) ||
      callArguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
    ) {
      return null;
    }
    const parameterValuesBySymbolId = new Map(state.parameterValuesBySymbolId);
    for (let parameterIndex = 0; parameterIndex < helperFunction.params.length; parameterIndex++) {
      const parameter = helperFunction.params[parameterIndex];
      const argument = callArguments[parameterIndex];
      if (!argument || !isNodeOfType(parameter, "Identifier")) continue;
      const parameterSymbol = context.scopes.symbolFor(parameter);
      if (parameterSymbol) parameterValuesBySymbolId.set(parameterSymbol.id, argument);
    }
    return readHydrationFunctionResult(helperFunction, context, runtime, {
      ...state,
      parameterValuesBySymbolId,
    });
  }
  if (isNodeOfType(unwrappedExpression, "BinaryExpression")) {
    const result = readHydrationPrimitiveResult(unwrappedExpression, context, runtime, state);
    return result?.kind === "boolean" && typeof result.value === "boolean" ? result.value : null;
  }
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "!"
  ) {
    const argumentResult = readHydrationConditionResult(
      unwrappedExpression.argument,
      context,
      runtime,
      state,
    );
    return argumentResult === null ? null : !argumentResult;
  }
  if (
    !isNodeOfType(unwrappedExpression, "LogicalExpression") ||
    (unwrappedExpression.operator !== "&&" && unwrappedExpression.operator !== "||")
  ) {
    return null;
  }
  return readLogicalConditionResult(
    unwrappedExpression.operator,
    readHydrationConditionResult(unwrappedExpression.left, context, runtime, state),
    readHydrationConditionResult(unwrappedExpression.right, context, runtime, state),
  );
};

const readHydrationStatementResult = (
  statement: EsTreeNode,
  context: RuleContext,
  runtime: "client" | "server",
  state: HydrationResolutionState,
): HydrationStatementResult => {
  if (isNodeOfType(statement, "ReturnStatement")) {
    return {
      didReturn: true,
      value: statement.argument
        ? readHydrationConditionResult(statement.argument, context, runtime, state)
        : null,
    };
  }
  if (isNodeOfType(statement, "BlockStatement")) {
    for (const childStatement of statement.body) {
      const result = readHydrationStatementResult(childStatement, context, runtime, state);
      if (result.didReturn) return result;
      if (statementAlwaysExits(childStatement)) break;
    }
    return { didReturn: false, value: null };
  }
  if (!isNodeOfType(statement, "IfStatement")) return { didReturn: false, value: null };
  const conditionResult = readHydrationConditionResult(statement.test, context, runtime, state);
  if (conditionResult !== null) {
    const selectedBranch = conditionResult ? statement.consequent : statement.alternate;
    return selectedBranch
      ? readHydrationStatementResult(selectedBranch, context, runtime, state)
      : { didReturn: false, value: null };
  }
  const consequentResult = readHydrationStatementResult(
    statement.consequent,
    context,
    runtime,
    state,
  );
  const alternateResult = statement.alternate
    ? readHydrationStatementResult(statement.alternate, context, runtime, state)
    : { didReturn: false, value: null };
  return consequentResult.didReturn &&
    alternateResult.didReturn &&
    consequentResult.value !== null &&
    consequentResult.value === alternateResult.value
    ? consequentResult
    : { didReturn: consequentResult.didReturn || alternateResult.didReturn, value: null };
};

const readHydrationFunctionResult = (
  functionNode: EsTreeNode,
  context: RuleContext,
  runtime: "client" | "server",
  state: HydrationResolutionState,
): boolean | null => {
  if (!isFunctionLike(functionNode) || state.visitedFunctionNodes.has(functionNode)) return null;
  state.visitedFunctionNodes.add(functionNode);
  const result = isNodeOfType(functionNode.body, "BlockStatement")
    ? readHydrationStatementResult(functionNode.body, context, runtime, state).value
    : readHydrationConditionResult(functionNode.body, context, runtime, state);
  state.visitedFunctionNodes.delete(functionNode);
  return result;
};

const doEquivalentExpressionBindingsMatch = (
  leftExpression: EsTreeNode,
  rightExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const left = stripParenExpression(leftExpression);
  const right = stripParenExpression(rightExpression);
  if (isNodeOfType(left, "Identifier") && isNodeOfType(right, "Identifier")) {
    const leftSymbol = scopes.symbolFor(left);
    const rightSymbol = scopes.symbolFor(right);
    return leftSymbol || rightSymbol ? leftSymbol?.id === rightSymbol?.id : true;
  }
  const rightEntries = new Map(Object.entries(right));
  for (const [key, leftValue] of Object.entries(left)) {
    if (key === "parent") continue;
    const rightValue = rightEntries.get(key);
    if (isAstNode(leftValue)) {
      if (
        !isAstNode(rightValue) ||
        !doEquivalentExpressionBindingsMatch(leftValue, rightValue, scopes)
      ) {
        return false;
      }
      continue;
    }
    if (!Array.isArray(leftValue)) continue;
    if (!Array.isArray(rightValue)) return false;
    const leftNodes = leftValue.filter(isAstNode);
    const rightNodes = rightValue.filter(isAstNode);
    if (
      leftNodes.length !== rightNodes.length ||
      leftNodes.some(
        (leftNode, index) =>
          !rightNodes[index] ||
          !doEquivalentExpressionBindingsMatch(leftNode, rightNodes[index], scopes),
      )
    ) {
      return false;
    }
  }
  return true;
};

const areHelperReturnValuesEquivalent = (
  leftValue: EsTreeNode,
  rightValue: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (areExpressionsStructurallyEqual(leftValue, rightValue))
    return doEquivalentExpressionBindingsMatch(leftValue, rightValue, context.scopes);
  const leftBoolean = readInitialStateBoolean(leftValue, context.scopes);
  const rightBoolean = readInitialStateBoolean(rightValue, context.scopes);
  return leftBoolean !== null && rightBoolean !== null && leftBoolean === rightBoolean;
};

const doHelperReturnValuesDiffer = (
  leftValues: ReadonlyArray<EsTreeNode>,
  rightValues: ReadonlyArray<EsTreeNode>,
  context: RuleContext,
): boolean => {
  const everyValueHasEquivalent = (
    values: ReadonlyArray<EsTreeNode>,
    candidateValues: ReadonlyArray<EsTreeNode>,
  ): boolean =>
    values.every((value) =>
      candidateValues.some((candidateValue) =>
        areHelperReturnValuesEquivalent(value, candidateValue, context),
      ),
    );

  return (
    !everyValueHasEquivalent(leftValues, rightValues) ||
    !everyValueHasEquivalent(rightValues, leftValues)
  );
};

const isExpressionProvablyReflexive = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (matchBrowserPredicate(unwrappedExpression, context)) return true;
  if (isNodeOfType(unwrappedExpression, "Literal")) {
    return (
      typeof unwrappedExpression.value !== "number" || !Number.isNaN(unwrappedExpression.value)
    );
  }
  if (
    isNodeOfType(unwrappedExpression, "Identifier") &&
    unwrappedExpression.name === "undefined" &&
    context.scopes.isGlobalReference(unwrappedExpression)
  ) {
    return true;
  }
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = context.scopes.symbolFor(unwrappedExpression);
    if (!symbol || visitedSymbolIds.has(symbol.id) || !symbol.initializer) return false;
    visitedSymbolIds.add(symbol.id);
    const assignedValues = symbol.references
      .filter((reference) => reference.flag !== "read")
      .map((reference) => getAssignedValue(reference.identifier));
    const isReflexive =
      isExpressionProvablyReflexive(symbol.initializer, context, visitedSymbolIds) &&
      assignedValues.every((assignedValue) =>
        Boolean(
          assignedValue && isExpressionProvablyReflexive(assignedValue, context, visitedSymbolIds),
        ),
      );
    visitedSymbolIds.delete(symbol.id);
    return isReflexive;
  }
  if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
    return (
      isExpressionProvablyReflexive(unwrappedExpression.consequent, context, visitedSymbolIds) &&
      isExpressionProvablyReflexive(unwrappedExpression.alternate, context, visitedSymbolIds)
    );
  }
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    (unwrappedExpression.operator === "!" ||
      unwrappedExpression.operator === "typeof" ||
      unwrappedExpression.operator === "void")
  ) {
    return true;
  }
  if (isNodeOfType(unwrappedExpression, "BinaryExpression")) {
    return (
      unwrappedExpression.operator === "===" ||
      unwrappedExpression.operator === "!==" ||
      unwrappedExpression.operator === "==" ||
      unwrappedExpression.operator === "!="
    );
  }
  if (
    isNodeOfType(unwrappedExpression, "ArrayExpression") ||
    isNodeOfType(unwrappedExpression, "ObjectExpression") ||
    isNodeOfType(unwrappedExpression, "FunctionExpression") ||
    isNodeOfType(unwrappedExpression, "ArrowFunctionExpression") ||
    isNodeOfType(unwrappedExpression, "TemplateLiteral")
  ) {
    return true;
  }
  if (!isNodeOfType(unwrappedExpression, "CallExpression")) return false;
  const callee = stripParenExpression(unwrappedExpression.callee);
  return (
    isNodeOfType(callee, "Identifier") &&
    callee.name === "Boolean" &&
    context.scopes.isGlobalReference(callee)
  );
};

const getReturnedObjectPropertyValues = (
  node: EsTreeNode,
  propertyName: string,
  scopes: ScopeAnalysis,
): ReadonlyArray<EsTreeNode> => {
  if (isNodeOfType(node, "ReturnStatement")) {
    return node.argument
      ? getReturnedObjectPropertyValues(node.argument, propertyName, scopes)
      : [];
  }
  if (isNodeOfType(node, "ObjectExpression")) {
    return node.properties.flatMap((property) =>
      isNodeOfType(property, "Property") &&
      property.kind === "init" &&
      getResolvedStaticPropertyName(property, scopes) === propertyName
        ? [property.value]
        : [],
    );
  }
  if (isNodeOfType(node, "IfStatement")) {
    return [
      ...getReturnedObjectPropertyValues(node.consequent, propertyName, scopes),
      ...(node.alternate
        ? getReturnedObjectPropertyValues(node.alternate, propertyName, scopes)
        : []),
    ];
  }
  if (isNodeOfType(node, "TryStatement")) {
    return [
      ...getReturnedObjectPropertyValues(node.block, propertyName, scopes),
      ...(node.handler
        ? getReturnedObjectPropertyValues(node.handler.body, propertyName, scopes)
        : []),
      ...(node.finalizer
        ? getReturnedObjectPropertyValues(node.finalizer, propertyName, scopes)
        : []),
    ];
  }
  if (!isNodeOfType(node, "BlockStatement")) return [];
  const propertyValues: Array<EsTreeNode> = [];
  for (const childStatement of node.body) {
    propertyValues.push(...getReturnedObjectPropertyValues(childStatement, propertyName, scopes));
    if (statementAlwaysExits(childStatement)) break;
  }
  return propertyValues;
};

const matchHydrationFunctionPropertyResult = (
  functionNode: EsTreeNode,
  propertyName: string,
  context: RuleContext,
  state: HydrationResolutionState,
): HydrationConditionMatch | null => {
  if (!isFunctionLike(functionNode) || state.visitedFunctionNodes.has(functionNode)) return null;
  state.visitedFunctionNodes.add(functionNode);
  const propertyValues = getReturnedObjectPropertyValues(
    functionNode.body,
    propertyName,
    context.scopes,
  );
  let match: HydrationConditionMatch | null = null;
  for (const propertyValue of propertyValues) {
    match = matchHydrationConditionInternal(propertyValue, context, state);
    if (match) break;
  }
  state.visitedFunctionNodes.delete(functionNode);
  return match;
};

const matchHydrationConditionInternal = (
  expression: EsTreeNode,
  context: RuleContext,
  state: HydrationResolutionState,
): HydrationConditionMatch | null => {
  const unwrappedExpression = stripParenExpression(expression);
  const predicateMatch = matchBrowserPredicate(unwrappedExpression, context);
  if (predicateMatch) return { predicateMatch, predicateNode: unwrappedExpression };
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = context.scopes.symbolFor(unwrappedExpression);
    const parameterValue = symbol ? state.parameterValuesBySymbolId.get(symbol.id) : null;
    if (symbol && parameterValue && !state.visitedSymbolIds.has(symbol.id)) {
      state.visitedSymbolIds.add(symbol.id);
      const match = matchHydrationConditionInternal(parameterValue, context, state);
      state.visitedSymbolIds.delete(symbol.id);
      return match;
    }
    if (
      symbol &&
      (symbol.kind === "let" || symbol.kind === "var") &&
      !state.visitedSymbolIds.has(symbol.id)
    ) {
      state.visitedSymbolIds.add(symbol.id);
      if (symbol.initializer && symbol.references.every((reference) => reference.flag === "read")) {
        const match = matchHydrationConditionInternal(symbol.initializer, context, state);
        state.visitedSymbolIds.delete(symbol.id);
        return match;
      }
      for (const reference of symbol.references) {
        if (reference.flag === "read") continue;
        if (!isNodeReachableWithinFunction(reference.identifier, context)) continue;
        const enclosingFunction = findEnclosingFunction(reference.identifier);
        if (!enclosingFunction) continue;
        for (const guardingIfStatement of findGuardingIfStatements(
          reference.identifier,
          enclosingFunction,
        )) {
          if (
            doesGuardPreserveInitialSymbolValue(symbol, guardingIfStatement, context.scopes) ||
            isWriteOverwrittenBefore(
              symbol,
              reference.identifier,
              guardingIfStatement,
              unwrappedExpression,
              context,
            )
          ) {
            continue;
          }
          const match = matchHydrationConditionInternal(guardingIfStatement.test, context, state);
          if (match) {
            state.visitedSymbolIds.delete(symbol.id);
            return match;
          }
        }
      }
      const readingFunction = findEnclosingFunction(unwrappedExpression);
      for (const reference of symbol.references) {
        if (reference.flag === "read") continue;
        const writingFunction = findEnclosingFunction(reference.identifier);
        if (
          !readingFunction ||
          !isFunctionLike(writingFunction) ||
          writingFunction === readingFunction ||
          writingFunction.async ||
          writingFunction.params.length > 0 ||
          (isNodeOfType(writingFunction, "FunctionDeclaration") && writingFunction.generator) ||
          (isNodeOfType(writingFunction, "FunctionExpression") && writingFunction.generator)
        ) {
          continue;
        }
        const assignedValue = getAssignedValue(reference.identifier);
        if (
          symbol.initializer &&
          assignedValue &&
          areExpressionsStructurallyEqual(symbol.initializer, assignedValue) &&
          doEquivalentExpressionBindingsMatch(symbol.initializer, assignedValue, context.scopes)
        ) {
          continue;
        }
        const functionBinding = getDirectFunctionBindingIdentifier(writingFunction);
        if (!isNodeOfType(functionBinding, "Identifier")) continue;
        const functionSymbol = context.scopes.symbolFor(functionBinding);
        if (!functionSymbol) continue;
        for (const functionReference of functionSymbol.references) {
          const callExpression = functionReference.identifier.parent;
          if (
            !isNodeOfType(callExpression, "CallExpression") ||
            callExpression.callee !== functionReference.identifier ||
            (callExpression.arguments ?? []).length > 0 ||
            findEnclosingFunction(callExpression) !== readingFunction ||
            !isNodeReachableWithinFunction(callExpression, context) ||
            getNodeStartIndex(callExpression) >= getNodeStartIndex(unwrappedExpression)
          ) {
            continue;
          }
          for (const guardingIfStatement of findGuardingIfStatements(
            callExpression,
            readingFunction,
          )) {
            if (
              isWriteOverwrittenBefore(
                symbol,
                callExpression,
                guardingIfStatement,
                unwrappedExpression,
                context,
              )
            ) {
              continue;
            }
            const match = matchHydrationConditionInternal(guardingIfStatement.test, context, state);
            if (match) {
              state.visitedSymbolIds.delete(symbol.id);
              return match;
            }
          }
        }
      }
      state.visitedSymbolIds.delete(symbol.id);
    }
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !symbol.initializer ||
      symbol.references.some((reference) => reference.flag !== "read") ||
      state.visitedSymbolIds.has(symbol.id)
    ) {
      return null;
    }
    state.visitedSymbolIds.add(symbol.id);
    const match = matchHydrationConditionInternal(symbol.initializer, context, state);
    state.visitedSymbolIds.delete(symbol.id);
    return match;
  }
  if (isNodeOfType(unwrappedExpression, "MemberExpression")) {
    const propertyName = getResolvedStaticPropertyName(unwrappedExpression, context.scopes, {
      allowConstNumericLiteral: true,
      stringifyNonStringLiterals: true,
    });
    const object = stripParenExpression(unwrappedExpression.object);
    if (propertyName === null || !isNodeOfType(object, "CallExpression")) return null;
    const callArguments = object.arguments ?? [];
    if (
      isReactApiCall(object, "useMemo", context.scopes, {
        allowGlobalReactNamespace: true,
        resolveNamedAliases: true,
      })
    ) {
      const callbackArgument = callArguments[0];
      if (!callbackArgument || isNodeOfType(callbackArgument, "SpreadElement")) return null;
      const callbackFunction = resolveExactLocalFunction(callbackArgument, context.scopes);
      return isFunctionLike(callbackFunction) && callbackFunction.params.length === 0
        ? matchHydrationFunctionPropertyResult(callbackFunction, propertyName, context, state)
        : null;
    }
    const helperFunction = resolveExactLocalFunction(object.callee, context.scopes);
    return isFunctionLike(helperFunction) &&
      helperFunction.params.length === 0 &&
      callArguments.length === 0
      ? matchHydrationFunctionPropertyResult(helperFunction, propertyName, context, state)
      : null;
  }
  if (isNodeOfType(unwrappedExpression, "CallExpression")) {
    const callArguments = unwrappedExpression.arguments ?? [];
    if (
      isReactApiCall(unwrappedExpression, "useState", context.scopes, {
        allowGlobalReactNamespace: true,
        resolveNamedAliases: true,
      })
    ) {
      const initialState = callArguments[0];
      if (!initialState || isNodeOfType(initialState, "SpreadElement")) return null;
      const lazyInitializer = resolveExactLocalFunction(initialState, context.scopes);
      return isFunctionLike(lazyInitializer) && lazyInitializer.params.length === 0
        ? matchHydrationFunctionResult(lazyInitializer, context, state)
        : matchHydrationConditionInternal(initialState, context, state);
    }
    if (
      isReactApiCall(unwrappedExpression, "useMemo", context.scopes, {
        allowGlobalReactNamespace: true,
        resolveNamedAliases: true,
      })
    ) {
      const callbackArgument = callArguments[0];
      if (!callbackArgument || isNodeOfType(callbackArgument, "SpreadElement")) return null;
      const callbackFunction = resolveExactLocalFunction(callbackArgument, context.scopes);
      return isFunctionLike(callbackFunction) && callbackFunction.params.length === 0
        ? matchHydrationFunctionResult(callbackFunction, context, state)
        : null;
    }
    const callee = stripParenExpression(unwrappedExpression.callee);
    if (
      isNodeOfType(callee, "Identifier") &&
      callee.name === "Boolean" &&
      context.scopes.isGlobalReference(callee) &&
      callArguments.length === 1 &&
      !isNodeOfType(callArguments[0], "SpreadElement")
    ) {
      return matchHydrationConditionInternal(callArguments[0], context, state);
    }
    const helperFunction = resolveExactLocalFunction(callee, context.scopes);
    if (
      !isFunctionLike(helperFunction) ||
      helperFunction.async ||
      (isNodeOfType(helperFunction, "FunctionDeclaration") && helperFunction.generator) ||
      (isNodeOfType(helperFunction, "FunctionExpression") && helperFunction.generator) ||
      helperFunction.params.some((parameter) => !isNodeOfType(parameter, "Identifier")) ||
      callArguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
    ) {
      return null;
    }
    const parameterValuesBySymbolId = new Map(state.parameterValuesBySymbolId);
    for (let parameterIndex = 0; parameterIndex < helperFunction.params.length; parameterIndex++) {
      const parameter = helperFunction.params[parameterIndex];
      const argument = callArguments[parameterIndex];
      if (!argument || !isNodeOfType(parameter, "Identifier")) continue;
      const parameterSymbol = context.scopes.symbolFor(parameter);
      if (parameterSymbol) parameterValuesBySymbolId.set(parameterSymbol.id, argument);
    }
    return matchHydrationFunctionResult(helperFunction, context, {
      ...state,
      parameterValuesBySymbolId,
    });
  }
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "!"
  ) {
    return matchHydrationConditionInternal(unwrappedExpression.argument, context, state);
  }
  if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
    const staticTestResult = readInitialStateBoolean(unwrappedExpression.test, context.scopes);
    if (staticTestResult !== null) {
      return matchHydrationConditionInternal(
        staticTestResult ? unwrappedExpression.consequent : unwrappedExpression.alternate,
        context,
        state,
      );
    }
    return (
      matchHydrationConditionInternal(unwrappedExpression.test, context, state) ??
      matchHydrationConditionInternal(unwrappedExpression.consequent, context, state) ??
      matchHydrationConditionInternal(unwrappedExpression.alternate, context, state)
    );
  }
  if (isNodeOfType(unwrappedExpression, "BinaryExpression")) {
    if (
      unwrappedExpression.operator !== "===" &&
      unwrappedExpression.operator !== "!==" &&
      unwrappedExpression.operator !== "==" &&
      unwrappedExpression.operator !== "!="
    ) {
      return null;
    }
    const leftMatch = matchHydrationConditionInternal(unwrappedExpression.left, context, state);
    const rightMatch = matchHydrationConditionInternal(unwrappedExpression.right, context, state);
    const nestedMatch = leftMatch ?? rightMatch;
    if (!nestedMatch) return null;
    const clientResult = readHydrationConditionResult(
      unwrappedExpression,
      context,
      "client",
      state,
    );
    const serverResult = readHydrationConditionResult(
      unwrappedExpression,
      context,
      "server",
      state,
    );
    if (clientResult !== null && serverResult !== null) {
      return clientResult !== serverResult ? nestedMatch : null;
    }
    return leftMatch &&
      rightMatch &&
      areExpressionsStructurallyEqual(unwrappedExpression.left, unwrappedExpression.right) &&
      doEquivalentExpressionBindingsMatch(
        unwrappedExpression.left,
        unwrappedExpression.right,
        context.scopes,
      ) &&
      isExpressionProvablyReflexive(unwrappedExpression.left, context)
      ? null
      : nestedMatch;
  }
  if (
    !isNodeOfType(unwrappedExpression, "LogicalExpression") ||
    (unwrappedExpression.operator !== "&&" && unwrappedExpression.operator !== "||")
  ) {
    return null;
  }
  const leftMatch = matchHydrationConditionInternal(unwrappedExpression.left, context, state);
  const rightMatch = matchHydrationConditionInternal(unwrappedExpression.right, context, state);
  const nestedMatch = leftMatch ?? rightMatch;
  if (!nestedMatch) return null;
  const clientResult = readHydrationConditionResult(unwrappedExpression, context, "client", state);
  const serverResult = readHydrationConditionResult(unwrappedExpression, context, "server", state);
  return clientResult !== null && serverResult !== null && clientResult === serverResult
    ? null
    : nestedMatch;
};

const matchHydrationReturningStatement = (
  statement: EsTreeNode,
  context: RuleContext,
  state: HydrationResolutionState,
): HydrationConditionMatch | null => {
  if (isNodeOfType(statement, "ReturnStatement")) {
    return statement.argument
      ? matchHydrationConditionInternal(statement.argument, context, state)
      : null;
  }
  if (isNodeOfType(statement, "IfStatement")) {
    const conditionMatch = matchHydrationConditionInternal(statement.test, context, state);
    const consequentValues = getReturnedValues(statement.consequent);
    const alternateValues = statement.alternate
      ? getReturnedValues(statement.alternate)
      : findFollowingReturnedValues(statement);
    if (
      conditionMatch &&
      consequentValues.length > 0 &&
      alternateValues.length > 0 &&
      doHelperReturnValuesDiffer(consequentValues, alternateValues, context)
    ) {
      return conditionMatch;
    }
    if (conditionMatch) {
      const followingReturnedValues = findFollowingReturnedValues(statement);
      const writtenSymbols = new Set([
        ...collectWrittenSymbols(statement.consequent, context.scopes),
        ...(statement.alternate ? collectWrittenSymbols(statement.alternate, context.scopes) : []),
      ]);
      if (
        [...writtenSymbols].some(
          (symbol) =>
            !doesGuardPreserveInitialSymbolValue(symbol, statement, context.scopes) &&
            followingReturnedValues.some((value) => doesNodeReadSymbol(value, symbol)),
        )
      ) {
        return conditionMatch;
      }
    }
    return (
      matchHydrationReturningStatement(statement.consequent, context, state) ??
      (statement.alternate
        ? matchHydrationReturningStatement(statement.alternate, context, state)
        : null)
    );
  }
  if (isNodeOfType(statement, "TryStatement")) {
    return (
      matchHydrationReturningStatement(statement.block, context, state) ??
      (statement.handler
        ? matchHydrationReturningStatement(statement.handler.body, context, state)
        : null) ??
      (statement.finalizer
        ? matchHydrationReturningStatement(statement.finalizer, context, state)
        : null)
    );
  }
  if (!isNodeOfType(statement, "BlockStatement")) return null;
  for (const childStatement of statement.body) {
    const match = matchHydrationReturningStatement(childStatement, context, state);
    if (match) return match;
    if (statementAlwaysExits(childStatement)) break;
  }
  return null;
};

const matchHydrationFunctionResult = (
  functionNode: EsTreeNode,
  context: RuleContext,
  state: HydrationResolutionState,
): HydrationConditionMatch | null => {
  if (!isFunctionLike(functionNode) || state.visitedFunctionNodes.has(functionNode)) return null;
  state.visitedFunctionNodes.add(functionNode);
  const match = isNodeOfType(functionNode.body, "BlockStatement")
    ? matchHydrationReturningStatement(functionNode.body, context, state)
    : matchHydrationConditionInternal(functionNode.body, context, state);
  state.visitedFunctionNodes.delete(functionNode);
  return match;
};

const matchHydrationCondition = (
  expression: EsTreeNode,
  context: RuleContext,
): HydrationConditionMatch | null =>
  matchHydrationConditionInternal(expression, context, {
    parameterValuesBySymbolId: new Map(),
    visitedFunctionNodes: new Set(),
    visitedSymbolIds: new Set(),
  });

const areNodeArraysEquivalent = (
  leftNodes: ReadonlyArray<EsTreeNode>,
  rightNodes: ReadonlyArray<EsTreeNode>,
  scopes: ScopeAnalysis,
): boolean =>
  leftNodes.length === rightNodes.length &&
  leftNodes.every((leftNode, index) =>
    areRenderedBranchesEquivalent(leftNode, rightNodes[index], scopes),
  );

const areRenderedBranchesEquivalent = (
  leftNode: EsTreeNode | null | undefined,
  rightNode: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
): boolean => {
  if (!leftNode || !rightNode) return leftNode === rightNode;
  const left = stripParenExpression(leftNode);
  const right = stripParenExpression(rightNode);
  if (areExpressionsStructurallyEqual(left, right)) {
    return doEquivalentExpressionBindingsMatch(left, right, scopes);
  }
  if (left.type !== right.type) return false;
  if (isNodeOfType(left, "JSXText") && isNodeOfType(right, "JSXText")) {
    return left.value === right.value;
  }
  if (
    isNodeOfType(left, "JSXExpressionContainer") &&
    isNodeOfType(right, "JSXExpressionContainer")
  ) {
    if (!isAstNode(left.expression) || !isAstNode(right.expression)) {
      return left.expression.type === right.expression.type;
    }
    return areRenderedBranchesEquivalent(left.expression, right.expression, scopes);
  }
  if (isNodeOfType(left, "JSXElement") && isNodeOfType(right, "JSXElement")) {
    if (flattenJsxName(left.openingElement.name) !== flattenJsxName(right.openingElement.name)) {
      return false;
    }
    if (
      !areNodeArraysEquivalent(
        left.openingElement.attributes,
        right.openingElement.attributes,
        scopes,
      )
    ) {
      return false;
    }
    return areNodeArraysEquivalent(left.children, right.children, scopes);
  }
  if (isNodeOfType(left, "JSXFragment") && isNodeOfType(right, "JSXFragment")) {
    return areNodeArraysEquivalent(left.children, right.children, scopes);
  }
  if (isNodeOfType(left, "JSXAttribute") && isNodeOfType(right, "JSXAttribute")) {
    if (flattenJsxName(left.name) !== flattenJsxName(right.name)) return false;
    return areRenderedBranchesEquivalent(left.value, right.value, scopes);
  }
  if (isNodeOfType(left, "JSXSpreadAttribute") && isNodeOfType(right, "JSXSpreadAttribute")) {
    return areRenderedBranchesEquivalent(left.argument, right.argument, scopes);
  }
  if (isNodeOfType(left, "TemplateLiteral") && isNodeOfType(right, "TemplateLiteral")) {
    if (left.quasis.length !== right.quasis.length) return false;
    if (
      !left.quasis.every(
        (quasi, index) =>
          quasi.value.cooked === right.quasis[index]?.value.cooked &&
          quasi.value.raw === right.quasis[index]?.value.raw,
      )
    ) {
      return false;
    }
    return areNodeArraysEquivalent(left.expressions, right.expressions, scopes);
  }
  return false;
};

const isProvenReactCreateElementCall = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    isReactApiCall(node, "createElement", scopes, {
      allowGlobalReactNamespace: true,
      resolveNamedAliases: true,
    })
  ) {
    return true;
  }
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== "createElement"
  ) {
    return false;
  }
  const receiver = stripParenExpression(callee.object);
  const namespaceIdentifier =
    isNodeOfType(receiver, "MemberExpression") &&
    !receiver.computed &&
    isNodeOfType(receiver.property, "Identifier") &&
    receiver.property.name === "default"
      ? stripParenExpression(receiver.object)
      : receiver;
  if (!isNodeOfType(namespaceIdentifier, "Identifier")) return false;
  const namespaceSymbol = scopes.symbolFor(namespaceIdentifier);
  return Boolean(
    namespaceSymbol?.initializer &&
    namespaceSymbol.references.every((reference) => reference.flag === "read") &&
    containsExplicitReactRuntimeReference(namespaceSymbol.initializer, scopes),
  );
};

const isRenderedValue = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const unwrappedNode = stripParenExpression(node);
  if (isNodeOfType(unwrappedNode, "Literal")) {
    return (
      unwrappedNode.value !== null &&
      unwrappedNode.value !== true &&
      unwrappedNode.value !== false &&
      unwrappedNode.value !== ""
    );
  }
  if (isNodeOfType(unwrappedNode, "TemplateLiteral")) {
    return unwrappedNode.expressions.length > 0 || unwrappedNode.quasis[0]?.value.cooked !== "";
  }
  if (isNodeOfType(unwrappedNode, "CallExpression"))
    return isProvenReactCreateElementCall(unwrappedNode, scopes);
  return isNodeOfType(unwrappedNode, "JSXElement") || isNodeOfType(unwrappedNode, "JSXFragment");
};

const findRenderedValueInAndBranch = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const unwrappedNode = stripParenExpression(node);
  if (isPotentiallyRenderedValue(unwrappedNode, scopes)) return unwrappedNode;
  if (!isNodeOfType(unwrappedNode, "LogicalExpression") || unwrappedNode.operator !== "&&") {
    return null;
  }
  return findRenderedValueInAndBranch(unwrappedNode.right, scopes);
};

const findEnclosingJsxAttribute = (node: EsTreeNode): EsTreeNodeOfType<"JSXAttribute"> | null => {
  let currentNode = node.parent;
  while (currentNode) {
    if (isNodeOfType(currentNode, "JSXAttribute")) return currentNode;
    if (
      isNodeOfType(currentNode, "JSXElement") ||
      isNodeOfType(currentNode, "JSXFragment") ||
      isFunctionLike(currentNode)
    ) {
      return null;
    }
    currentNode = currentNode.parent;
  }
  return null;
};

const isInRenderedOutput = (
  node: EsTreeNode,
  componentOrHookNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let currentNode = node;
  let parentNode = currentNode.parent;
  while (parentNode) {
    if (isNodeOfType(parentNode, "JSXExpressionContainer")) {
      const attribute = findEnclosingJsxAttribute(parentNode);
      return attribute ? !isEventHandlerAttribute(attribute) : true;
    }
    if (isNodeOfType(parentNode, "ReturnStatement")) {
      const returnFunction = findEnclosingFunction(parentNode);
      if (returnFunction === componentOrHookNode) return true;
    }
    if (parentNode === componentOrHookNode) {
      return (
        isFunctionLike(componentOrHookNode) &&
        !isNodeOfType(componentOrHookNode.body, "BlockStatement") &&
        componentOrHookNode.body === currentNode
      );
    }
    if (isFunctionLike(parentNode) && !executesDuringRender(parentNode, scopes)) return false;
    currentNode = parentNode;
    parentNode = currentNode.parent;
  }
  return false;
};

const getReturnedValues = (statement: EsTreeNode | null | undefined): ReadonlyArray<EsTreeNode> => {
  if (!statement) return [];
  if (isNodeOfType(statement, "ReturnStatement")) {
    return statement.argument ? [statement.argument] : [];
  }
  if (isNodeOfType(statement, "IfStatement")) {
    return [...getReturnedValues(statement.consequent), ...getReturnedValues(statement.alternate)];
  }
  if (isNodeOfType(statement, "TryStatement")) {
    return [
      ...getReturnedValues(statement.block),
      ...getReturnedValues(statement.handler?.body),
      ...getReturnedValues(statement.finalizer),
    ];
  }
  if (!isNodeOfType(statement, "BlockStatement")) return [];
  const returnedValues: Array<EsTreeNode> = [];
  for (const childStatement of statement.body) {
    returnedValues.push(...getReturnedValues(childStatement));
    if (statementAlwaysExits(childStatement)) break;
  }
  return returnedValues;
};

const isPotentiallyRenderedValueInternal = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedFunctionNodes: Set<EsTreeNode>,
): boolean => {
  const unwrappedNode = stripParenExpression(node);
  if (isRenderedValue(unwrappedNode, scopes)) return true;
  if (isNodeOfType(unwrappedNode, "ConditionalExpression")) {
    return (
      isPotentiallyRenderedValueInternal(unwrappedNode.consequent, scopes, visitedFunctionNodes) &&
      isPotentiallyRenderedValueInternal(unwrappedNode.alternate, scopes, visitedFunctionNodes)
    );
  }
  if (isNodeOfType(unwrappedNode, "LogicalExpression")) {
    return isPotentiallyRenderedValueInternal(unwrappedNode.right, scopes, visitedFunctionNodes);
  }
  if (!isNodeOfType(unwrappedNode, "CallExpression")) return false;
  const calledFunction = resolveExactLocalFunction(unwrappedNode.callee, scopes);
  if (!isFunctionLike(calledFunction) || visitedFunctionNodes.has(calledFunction)) return false;
  visitedFunctionNodes.add(calledFunction);
  const returnedValues = isNodeOfType(calledFunction.body, "BlockStatement")
    ? getReturnedValues(calledFunction.body)
    : [calledFunction.body];
  const isPotentiallyRendered =
    returnedValues.length > 0 &&
    returnedValues.every((returnedValue) =>
      isPotentiallyRenderedValueInternal(returnedValue, scopes, visitedFunctionNodes),
    );
  visitedFunctionNodes.delete(calledFunction);
  return isPotentiallyRendered;
};

const isPotentiallyRenderedValue = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isPotentiallyRenderedValueInternal(node, scopes, new Set());

const findUseStateBindingSymbol = (
  node: EsTreeNode,
  componentOrHookNode: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  let currentNode = node.parent;
  while (currentNode && currentNode !== componentOrHookNode) {
    if (
      isNodeOfType(currentNode, "CallExpression") &&
      isReactApiCall(currentNode, "useState", scopes, {
        allowGlobalReactNamespace: true,
        resolveNamedAliases: true,
      }) &&
      isNodeOfType(currentNode.parent, "VariableDeclarator") &&
      isNodeOfType(currentNode.parent.id, "ArrayPattern")
    ) {
      const stateBinding = currentNode.parent.id.elements?.[0];
      return isNodeOfType(stateBinding, "Identifier") ? scopes.symbolFor(stateBinding) : null;
    }
    if (isFunctionLike(currentNode)) return null;
    currentNode = currentNode.parent;
  }
  return null;
};

const doesReferenceControlStructuralRenderedValue = (referenceIdentifier: EsTreeNode): boolean => {
  let currentNode = referenceIdentifier;
  let parentNode = currentNode.parent;
  while (parentNode) {
    if (
      isNodeOfType(parentNode, "ConditionalExpression") &&
      parentNode.test === currentNode &&
      (isStructuralRenderedValue(parentNode.consequent) ||
        isStructuralRenderedValue(parentNode.alternate))
    ) {
      return true;
    }
    if (
      isNodeOfType(parentNode, "LogicalExpression") &&
      parentNode.left === currentNode &&
      isStructuralRenderedValue(parentNode.right)
    ) {
      return true;
    }
    if (isNodeOfType(parentNode, "JSXExpressionContainer") || isFunctionLike(parentNode)) {
      return false;
    }
    currentNode = parentNode;
    parentNode = currentNode.parent;
  }
  return false;
};

const isRenderedHydrationConsumer = (
  node: EsTreeNode,
  producerHookNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const renderingComponent = findRenderPhaseComponentOrHook(node, scopes);
  return Boolean(
    renderingComponent &&
    renderingComponent !== producerHookNode &&
    isInRenderedOutput(node, renderingComponent, scopes) &&
    !isGatedByFalsyInitialState(node, scopes) &&
    !isAfterClientOnlyEarlyReturn(node, renderingComponent, scopes) &&
    (!hasSuppressHydrationWarningAttribute(findEnclosingJsxOpeningElement(node)) ||
      doesReferenceControlStructuralRenderedValue(node)),
  );
};

const doesConsumerExpressionReachRenderedOutput = (
  node: EsTreeNode,
  producerHookNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  if (isRenderedHydrationConsumer(node, producerHookNode, scopes)) return true;
  const parentNode = node.parent;
  if (
    !isNodeOfType(parentNode, "VariableDeclarator") ||
    parentNode.init !== node ||
    !isNodeOfType(parentNode.id, "Identifier")
  ) {
    return false;
  }
  const aliasSymbol = scopes.symbolFor(parentNode.id);
  if (!aliasSymbol || visitedSymbolIds.has(aliasSymbol.id)) return false;
  visitedSymbolIds.add(aliasSymbol.id);
  const doesReachRenderedOutput = aliasSymbol.references.some((reference) =>
    doesConsumerExpressionReachRenderedOutput(
      reference.identifier,
      producerHookNode,
      scopes,
      visitedSymbolIds,
    ),
  );
  visitedSymbolIds.delete(aliasSymbol.id);
  return doesReachRenderedOutput;
};

const doesConsumerBindingReachRenderedOutput = (
  bindingIdentifier: EsTreeNode,
  producerHookNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(bindingIdentifier, "Identifier")) return false;
  const consumerSymbol = scopes.symbolFor(bindingIdentifier);
  if (!consumerSymbol) return false;
  return consumerSymbol.references.some((reference) =>
    doesConsumerExpressionReachRenderedOutput(
      reference.identifier,
      producerHookNode,
      scopes,
      new Set([consumerSymbol.id]),
    ),
  );
};

const getReturnedStatePaths = (
  returnedValue: EsTreeNode,
  stateSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): ReadonlyArray<ReturnedStatePath> => {
  const unwrappedValue = stripParenExpression(returnedValue);
  if (isNodeOfType(unwrappedValue, "ObjectExpression")) {
    return unwrappedValue.properties.flatMap((property) => {
      if (
        !isNodeOfType(property, "Property") ||
        property.kind !== "init" ||
        !doesNodeReadSymbol(property.value, stateSymbol)
      ) {
        return [];
      }
      const propertyName = getResolvedStaticPropertyName(property, scopes);
      return propertyName === null ? [] : [{ kind: "property", key: propertyName }];
    });
  }
  if (isNodeOfType(unwrappedValue, "ArrayExpression")) {
    return (unwrappedValue.elements ?? []).flatMap((element, index) =>
      element && isAstNode(element) && doesNodeReadSymbol(element, stateSymbol)
        ? [{ kind: "index", key: String(index) }]
        : [],
    );
  }
  return doesNodeReadSymbol(unwrappedValue, stateSymbol) ? [{ kind: "direct", key: null }] : [];
};

const doesCallResultPathReachRenderedOutput = (
  callExpression: EsTreeNode,
  returnedStatePath: ReturnedStatePath,
  producerHookNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const callParent = callExpression.parent;
  if (returnedStatePath.kind === "direct") {
    return doesConsumerExpressionReachRenderedOutput(
      callExpression,
      producerHookNode,
      scopes,
      new Set(),
    );
  }
  if (
    isNodeOfType(callParent, "MemberExpression") &&
    callParent.object === callExpression &&
    getResolvedStaticPropertyName(callParent, scopes, {
      allowConstNumericLiteral: true,
      stringifyNonStringLiterals: true,
    }) === returnedStatePath.key
  ) {
    return doesConsumerExpressionReachRenderedOutput(
      callParent,
      producerHookNode,
      scopes,
      new Set(),
    );
  }
  if (!isNodeOfType(callParent, "VariableDeclarator") || callParent.init !== callExpression) {
    return false;
  }
  if (returnedStatePath.kind === "property" && isNodeOfType(callParent.id, "ObjectPattern")) {
    return callParent.id.properties.some(
      (property) =>
        isNodeOfType(property, "Property") &&
        getResolvedStaticPropertyName(property, scopes) === returnedStatePath.key &&
        doesConsumerBindingReachRenderedOutput(property.value, producerHookNode, scopes),
    );
  }
  if (returnedStatePath.kind === "index" && isNodeOfType(callParent.id, "ArrayPattern")) {
    const element = callParent.id.elements?.[Number(returnedStatePath.key)];
    return Boolean(
      element && doesConsumerBindingReachRenderedOutput(element, producerHookNode, scopes),
    );
  }
  if (!isNodeOfType(callParent.id, "Identifier")) return false;
  const resultSymbol = scopes.symbolFor(callParent.id);
  if (!resultSymbol) return false;
  return resultSymbol.references.some((reference) => {
    const memberExpression = reference.identifier.parent;
    return Boolean(
      isNodeOfType(memberExpression, "MemberExpression") &&
      memberExpression.object === reference.identifier &&
      getResolvedStaticPropertyName(memberExpression, scopes, {
        allowConstNumericLiteral: true,
        stringifyNonStringLiterals: true,
      }) === returnedStatePath.key &&
      doesConsumerExpressionReachRenderedOutput(
        memberExpression,
        producerHookNode,
        scopes,
        new Set([resultSymbol.id]),
      ),
    );
  });
};

const isReturnedUseStateInitializerRendered = (
  node: EsTreeNode,
  componentOrHookNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isFunctionLike(componentOrHookNode)) return false;
  const stateSymbol = findUseStateBindingSymbol(node, componentOrHookNode, scopes);
  if (!stateSymbol) return false;
  const returnedValues = isNodeOfType(componentOrHookNode.body, "BlockStatement")
    ? getReturnedValues(componentOrHookNode.body)
    : [componentOrHookNode.body];
  const returnedStatePaths = returnedValues.flatMap((returnedValue) =>
    getReturnedStatePaths(returnedValue, stateSymbol, scopes),
  );
  if (returnedStatePaths.length === 0) return false;
  const functionBinding = getDirectFunctionBindingIdentifier(componentOrHookNode);
  if (!isNodeOfType(functionBinding, "Identifier")) return false;
  const functionSymbol = scopes.symbolFor(functionBinding);
  if (!functionSymbol) return false;
  return functionSymbol.references.some((functionReference) => {
    const callExpression = functionReference.identifier.parent;
    return Boolean(
      isNodeOfType(callExpression, "CallExpression") &&
      callExpression.callee === functionReference.identifier &&
      returnedStatePaths.some((returnedStatePath) =>
        doesCallResultPathReachRenderedOutput(
          callExpression,
          returnedStatePath,
          componentOrHookNode,
          scopes,
        ),
      ),
    );
  });
};

const findFollowingReturnedValues = (
  ifStatement: EsTreeNodeOfType<"IfStatement">,
): ReadonlyArray<EsTreeNode> => {
  const parentNode = ifStatement.parent;
  if (!isNodeOfType(parentNode, "BlockStatement")) return [];
  const statementIndex = parentNode.body.findIndex((statement) => statement === ifStatement);
  if (statementIndex < 0) return [];
  const returnedValues: Array<EsTreeNode> = [];
  for (const statement of parentNode.body.slice(statementIndex + 1)) {
    returnedValues.push(...getReturnedValues(statement));
    if (statementAlwaysExits(statement)) break;
  }
  return returnedValues;
};

const areConditionExpressionsEquivalent = (
  leftExpression: EsTreeNode,
  rightExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const left = stripParenExpression(leftExpression);
  const right = stripParenExpression(rightExpression);
  if (areExpressionsStructurallyEqual(left, right)) {
    return doEquivalentExpressionBindingsMatch(left, right, scopes);
  }
  if (left.type !== right.type) return false;
  if (isNodeOfType(left, "UnaryExpression") && isNodeOfType(right, "UnaryExpression")) {
    return (
      left.operator === right.operator &&
      areConditionExpressionsEquivalent(left.argument, right.argument, scopes)
    );
  }
  if (isNodeOfType(left, "LogicalExpression") && isNodeOfType(right, "LogicalExpression")) {
    return (
      left.operator === right.operator &&
      areConditionExpressionsEquivalent(left.left, right.left, scopes) &&
      areConditionExpressionsEquivalent(left.right, right.right, scopes)
    );
  }
  if (isNodeOfType(left, "BinaryExpression") && isNodeOfType(right, "BinaryExpression")) {
    return (
      left.operator === right.operator &&
      areConditionExpressionsEquivalent(left.left, right.left, scopes) &&
      areConditionExpressionsEquivalent(left.right, right.right, scopes)
    );
  }
  return false;
};

const areReturnTreesEquivalent = (
  leftStatement: EsTreeNode | null | undefined,
  rightStatement: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
): boolean => {
  if (!leftStatement || !rightStatement) return leftStatement === rightStatement;
  if (
    isNodeOfType(leftStatement, "ReturnStatement") &&
    isNodeOfType(rightStatement, "ReturnStatement")
  ) {
    return areRenderedBranchesEquivalent(leftStatement.argument, rightStatement.argument, scopes);
  }
  if (isNodeOfType(leftStatement, "IfStatement") && isNodeOfType(rightStatement, "IfStatement")) {
    return (
      areConditionExpressionsEquivalent(leftStatement.test, rightStatement.test, scopes) &&
      areReturnTreesEquivalent(leftStatement.consequent, rightStatement.consequent, scopes) &&
      areReturnTreesEquivalent(leftStatement.alternate, rightStatement.alternate, scopes)
    );
  }
  if (
    !isNodeOfType(leftStatement, "BlockStatement") ||
    !isNodeOfType(rightStatement, "BlockStatement")
  ) {
    return false;
  }
  const leftReturningStatements = leftStatement.body.filter(
    (statement) => getReturnedValues(statement).length > 0,
  );
  const rightReturningStatements = rightStatement.body.filter(
    (statement) => getReturnedValues(statement).length > 0,
  );
  return (
    leftReturningStatements.length === rightReturningStatements.length &&
    leftReturningStatements.every((statement, index) =>
      areReturnTreesEquivalent(statement, rightReturningStatements[index], scopes),
    )
  );
};

const isStructuralRenderedValue = (node: EsTreeNode | null): boolean => {
  if (!node) return false;
  const unwrappedNode = stripParenExpression(node);
  return isNodeOfType(unwrappedNode, "JSXElement") || isNodeOfType(unwrappedNode, "JSXFragment");
};

const branchRootsSuppressSameElement = (
  leftBranch: EsTreeNode,
  rightBranch: EsTreeNode | null,
): boolean => {
  if (!rightBranch) return false;
  const left = stripParenExpression(leftBranch);
  const right = stripParenExpression(rightBranch);
  return (
    isNodeOfType(left, "JSXElement") &&
    isNodeOfType(right, "JSXElement") &&
    flattenJsxName(left.openingElement.name) === flattenJsxName(right.openingElement.name) &&
    hasSuppressHydrationWarningAttribute(left.openingElement) &&
    hasSuppressHydrationWarningAttribute(right.openingElement)
  );
};

export const noHydrationBranchOnBrowserGlobal = defineRule({
  id: "no-hydration-branch-on-browser-global",
  title: "Server and client render different branches",
  severity: "error",
  category: "Correctness",
  requires: ["ssr"],
  recommendation:
    "Render the same initial output on the server and client, then switch after mount or use useSyncExternalStore with a stable server snapshot.",
  create: (context: RuleContext): RuleVisitors => {
    if (isTestlikeFilename(context.filename)) return EMPTY_RULE_VISITORS;
    if (classifyReactNativeFileTarget(context) === "react-native") return EMPTY_RULE_VISITORS;
    let fileHasUseClientDirective = false;
    let fileHasExplicitReactRuntimeReference = false;
    let fileIsEmailTemplate = false;
    const reportedNodes = new Set<EsTreeNode>();

    const reportHydrationBranch = (
      conditionNode: EsTreeNode,
      leftBranch: EsTreeNode,
      rightBranch: EsTreeNode | null,
      requiresRenderedContext: boolean,
      hasProvenRenderedConsumer = false,
    ): void => {
      const conditionMatch = matchHydrationCondition(conditionNode, context);
      if (!conditionMatch) return;
      const { predicateMatch, predicateNode } = conditionMatch;
      if (reportedNodes.has(predicateNode)) return;
      if (rightBranch && areRenderedBranchesEquivalent(leftBranch, rightBranch, context.scopes)) {
        return;
      }
      const enclosingFunction = findEnclosingFunction(conditionNode);
      const componentOrHookNode =
        findRenderPhaseComponentOrHook(conditionNode, context.scopes) ??
        (enclosingFunction
          ? findComponentRenderingLocalFunctionResult(enclosingFunction, context.scopes)
          : null);
      if (!componentOrHookNode) return;
      const hasRenderedLocalFunctionConsumer = Boolean(
        enclosingFunction &&
        enclosingFunction !== componentOrHookNode &&
        findComponentRenderingLocalFunctionResult(enclosingFunction, context.scopes) ===
          componentOrHookNode,
      );
      if (
        !hasClientRenderEvidence(componentOrHookNode, fileHasUseClientDirective) &&
        !fileHasExplicitReactRuntimeReference
      ) {
        return;
      }
      if (
        requiresRenderedContext &&
        !isInRenderedOutput(conditionNode, componentOrHookNode, context.scopes) &&
        !hasRenderedLocalFunctionConsumer
      )
        return;
      if (
        !hasProvenRenderedConsumer &&
        !(requiresRenderedContext
          ? isPotentiallyRenderedValue(leftBranch, context.scopes)
          : isRenderedValue(leftBranch, context.scopes)) &&
        (!rightBranch ||
          !(requiresRenderedContext
            ? isPotentiallyRenderedValue(rightBranch, context.scopes)
            : isRenderedValue(rightBranch, context.scopes)))
      ) {
        const attribute = findEnclosingJsxAttribute(conditionNode);
        if (!attribute || isEventHandlerAttribute(attribute)) return;
      }
      if (fileIsEmailTemplate || isGatedByFalsyInitialState(conditionNode, context.scopes)) {
        return;
      }
      if (isAfterClientOnlyEarlyReturn(conditionNode, componentOrHookNode, context.scopes)) return;
      const openingElement = findEnclosingJsxOpeningElement(conditionNode);
      if (
        hasSuppressHydrationWarningAttribute(openingElement) &&
        !isStructuralRenderedValue(leftBranch) &&
        !isStructuralRenderedValue(rightBranch)
      ) {
        return;
      }
      if (branchRootsSuppressSameElement(leftBranch, rightBranch)) return;
      if (isGeneratedImageRenderContext(context, openingElement ?? leftBranch)) {
        return;
      }
      reportedNodes.add(predicateNode);
      context.report({
        node: predicateNode,
        message: `\`typeof ${predicateMatch.browserGlobalName}\` selects different rendered output on the server and during hydration. Render the same initial output, then switch after mount.`,
      });
    };

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        fileHasUseClientDirective = hasDirective(node, "use client");
        fileHasExplicitReactRuntimeReference = containsExplicitReactRuntimeReference(
          node,
          context.scopes,
        );
        fileIsEmailTemplate = hasEmailTemplateImport(node);
      },
      ConditionalExpression(node: EsTreeNodeOfType<"ConditionalExpression">) {
        reportHydrationBranch(node.test, node.consequent, node.alternate, true);
        const componentOrHookNode = findRenderPhaseComponentOrHook(node, context.scopes);
        if (
          componentOrHookNode &&
          isReturnedUseStateInitializerRendered(node, componentOrHookNode, context.scopes)
        ) {
          reportHydrationBranch(node.test, node.consequent, node.alternate, false, true);
        }
      },
      LogicalExpression(node: EsTreeNodeOfType<"LogicalExpression">) {
        if (node.operator !== "&&" && node.operator !== "||") return;
        const renderedValue =
          node.operator === "&&"
            ? findRenderedValueInAndBranch(node.right, context.scopes)
            : isPotentiallyRenderedValue(node.right, context.scopes)
              ? node.right
              : null;
        if (!renderedValue) return;
        reportHydrationBranch(node, renderedValue, null, true);
      },
      IfStatement(node: EsTreeNodeOfType<"IfStatement">) {
        if (
          node.alternate &&
          areReturnTreesEquivalent(node.consequent, node.alternate, context.scopes)
        ) {
          return;
        }
        const consequentValues = getReturnedValues(node.consequent);
        const alternateValues = node.alternate
          ? getReturnedValues(node.alternate)
          : findFollowingReturnedValues(node);
        if (consequentValues.length === 0 || alternateValues.length === 0) return;
        const enclosingFunction = findEnclosingFunction(node);
        const componentOrHookNode =
          findRenderPhaseComponentOrHook(node.test, context.scopes) ??
          (enclosingFunction
            ? findComponentRenderingLocalFunctionResult(enclosingFunction, context.scopes)
            : null);
        if (!componentOrHookNode) return;
        if (
          enclosingFunction !== componentOrHookNode &&
          (!enclosingFunction ||
            (!isInRenderedOutput(enclosingFunction, componentOrHookNode, context.scopes) &&
              findComponentRenderingLocalFunctionResult(enclosingFunction, context.scopes) !==
                componentOrHookNode))
        ) {
          return;
        }
        for (const consequentValue of consequentValues) {
          for (const alternateValue of alternateValues) {
            if (
              !isRenderedValue(consequentValue, context.scopes) &&
              !isRenderedValue(alternateValue, context.scopes)
            ) {
              continue;
            }
            reportHydrationBranch(node.test, consequentValue, alternateValue, false);
          }
        }
      },
    };
  },
});
