import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { collectConstAliasSymbols } from "../../utils/collect-const-alias-symbols.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getFunctionBindingName } from "../../utils/get-function-binding-name.js";
import { getFunctionBindingSymbols } from "../../utils/get-function-binding-symbols.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isEffectCallbackReference } from "../../utils/is-effect-callback-reference.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNullishExpression } from "../../utils/is-nullish-expression.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isReactEffectHookCall } from "../../utils/is-react-effect-hook-call.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveReactRefSymbol } from "../../utils/react-ref-origin.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { tokenizeIdentifierWords } from "../../utils/tokenize-identifier-words.js";
import { resolveTanstackMutationHookNameFromInitializer } from "./utils/resolve-tanstack-query-hook-name.js";

interface EffectInvocation {
  callback: EsTreeNode;
  pathNodes: EsTreeNode[];
}

interface StatusTarget {
  symbolId: number;
  propertyName: string | null;
  sourcePropertyName: string;
}

const ACKNOWLEDGEMENT_FIELD_NAMES = new Set([
  "code",
  "error",
  "errors",
  "message",
  "ok",
  "status",
  "success",
]);

const READ_INTENT_WORDS = new Set([
  "check",
  "fetch",
  "find",
  "get",
  "list",
  "load",
  "lookup",
  "query",
  "read",
  "retrieve",
  "search",
]);

const hasReadIntentName = (name: string | null): boolean => {
  if (!name) return false;
  const words = tokenizeIdentifierWords(name);
  if (
    words.some(
      (word, wordIndex) => word === "check" && ["in", "out"].includes(words[wordIndex + 1] ?? ""),
    )
  ) {
    return false;
  }
  return words.some((word, wordIndex) => {
    if (word === "list") return wordIndex === 0;
    return READ_INTENT_WORDS.has(word);
  });
};

const getPatternBindings = (
  pattern: EsTreeNode,
  propertyName: string,
): EsTreeNodeOfType<"Identifier">[] => {
  if (!isNodeOfType(pattern, "ObjectPattern")) return [];
  const bindings: EsTreeNodeOfType<"Identifier">[] = [];
  for (const property of pattern.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      getStaticPropertyKeyName(property, { allowComputedString: true }) !== propertyName
    ) {
      continue;
    }
    const value = isNodeOfType(property.value, "AssignmentPattern")
      ? property.value.left
      : property.value;
    if (isNodeOfType(value, "Identifier")) bindings.push(value);
  }
  return bindings;
};

const findFunctionSymbol = (
  functionNode: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => getFunctionBindingSymbols(functionNode, context.scopes)[0] ?? null;

const resolveLocalFunction = (expression: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  const candidate = stripParenExpression(expression);
  const directFunction = resolveExactLocalFunction(candidate, context.scopes);
  if (directFunction) return directFunction;
  const symbol = isNodeOfType(candidate, "Identifier")
    ? resolveConstIdentifierAlias(candidate, context.scopes)
    : null;
  const initializer = stripParenExpression(symbol?.initializer ?? candidate);
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    !isReactApiCall(initializer, "useCallback", context.scopes)
  ) {
    return null;
  }
  const callback = initializer.arguments[0];
  return callback ? resolveExactLocalFunction(callback, context.scopes) : null;
};

const collectEffectInvocations = (
  node: EsTreeNode,
  context: RuleContext,
  visitedFunctions: Set<EsTreeNode> = new Set(),
): EffectInvocation[] => {
  const functionNode = findEnclosingFunction(node);
  if (!functionNode || visitedFunctions.has(functionNode)) return [];
  visitedFunctions.add(functionNode);

  const functionRoot = findTransparentExpressionRoot(functionNode);
  const directCall = functionRoot.parent;
  if (
    isNodeOfType(directCall, "CallExpression") &&
    stripParenExpression(directCall.callee) === functionNode
  ) {
    return collectEffectInvocations(directCall, context, visitedFunctions).map((invocation) => ({
      callback: invocation.callback,
      pathNodes: [node, ...invocation.pathNodes],
    }));
  }

  if (isEffectCallbackReference(functionNode, context.scopes)) {
    return [{ callback: functionNode, pathNodes: [node] }];
  }

  const functionSymbol = findFunctionSymbol(functionNode, context);
  if (functionSymbol) {
    const functionSymbols = collectConstAliasSymbols(functionSymbol, context.scopes);
    for (const symbol of functionSymbols) {
      for (const reference of symbol.references) {
        if (isEffectCallbackReference(reference.identifier, context.scopes)) {
          return [{ callback: functionNode, pathNodes: [node] }];
        }
      }
    }
    const invocations: EffectInvocation[] = [];
    for (const symbol of functionSymbols) {
      for (const reference of symbol.references) {
        const referenceRoot = findTransparentExpressionRoot(reference.identifier);
        const callSite = referenceRoot.parent;
        if (!isNodeOfType(callSite, "CallExpression") || callSite.callee !== referenceRoot) {
          continue;
        }
        for (const invocation of collectEffectInvocations(callSite, context, visitedFunctions)) {
          invocations.push({
            callback: invocation.callback,
            pathNodes: [node, callSite, ...invocation.pathNodes],
          });
        }
      }
    }
    return invocations;
  }

  return [];
};

const isInEffectDependencyArray = (node: EsTreeNode, context: RuleContext): boolean => {
  let current: EsTreeNode = node;
  let parent = current.parent;
  while (parent && !isFunctionLike(parent)) {
    if (isNodeOfType(parent, "ArrayExpression")) {
      const dependencyArrayRoot = findTransparentExpressionRoot(parent);
      const callExpression = dependencyArrayRoot.parent;
      return Boolean(
        isNodeOfType(callExpression, "CallExpression") &&
        callExpression.arguments[1] === dependencyArrayRoot &&
        isReactEffectHookCall(callExpression, context.scopes),
      );
    }
    current = parent;
    parent = current.parent;
  }
  return false;
};

const isGuardOnlyReference = (node: EsTreeNode, context: RuleContext): boolean => {
  const expressionRoot = findTransparentExpressionRoot(node);
  const parent = expressionRoot.parent;
  if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") return true;
  if (
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments[0] === expressionRoot &&
    isNodeOfType(parent.callee, "Identifier") &&
    parent.callee.name === "Boolean" &&
    context.scopes.isGlobalReference(parent.callee)
  ) {
    return true;
  }
  if (isNodeOfType(parent, "LogicalExpression")) {
    if (parent.left !== expressionRoot && parent.right !== expressionRoot) return false;
    if (parent.left === expressionRoot && parent.operator === "&&") return true;
    return isGuardOnlyReference(parent, context);
  }
  if (isNodeOfType(parent, "ConditionalExpression")) {
    if (parent.test === expressionRoot) return true;
    return isGuardOnlyReference(parent, context);
  }
  if (isNodeOfType(parent, "SequenceExpression") && parent.expressions.at(-1) === expressionRoot) {
    return isGuardOnlyReference(parent, context);
  }
  if (
    (isNodeOfType(parent, "IfStatement") ||
      isNodeOfType(parent, "WhileStatement") ||
      isNodeOfType(parent, "DoWhileStatement") ||
      isNodeOfType(parent, "ForStatement")) &&
    parent.test === expressionRoot
  ) {
    return true;
  }
  if (
    isNodeOfType(parent, "BinaryExpression") &&
    ["==", "!=", "===", "!=="].includes(parent.operator)
  ) {
    const otherOperand = parent.left === expressionRoot ? parent.right : parent.left;
    return isNullishExpression(otherOperand);
  }
  return false;
};

const objectPatternConsumesResponse = (pattern: EsTreeNodeOfType<"ObjectPattern">): boolean =>
  pattern.properties.some((property) => {
    if (!isNodeOfType(property, "Property")) return true;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    return propertyName === null || !ACKNOWLEDGEMENT_FIELD_NAMES.has(propertyName);
  });

const symbolHasConsumerRead = (
  symbol: SymbolDescriptor,
  context: RuleContext,
  visitedSymbols: Set<number> = new Set(),
): boolean => {
  if (visitedSymbols.has(symbol.id)) return false;
  visitedSymbols.add(symbol.id);
  return symbol.references.some((reference) =>
    responseExpressionIsConsumed(reference.identifier, context, visitedSymbols),
  );
};

const responseExpressionIsConsumed = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbols: Set<number>,
): boolean => {
  const directParent = expression.parent;
  if (
    isNodeOfType(directParent, "Property") &&
    isNodeOfType(directParent.parent, "ObjectPattern")
  ) {
    return false;
  }
  if (isInEffectDependencyArray(expression, context) || isGuardOnlyReference(expression, context)) {
    return false;
  }
  let expressionRoot = findTransparentExpressionRoot(expression);
  let parent = expressionRoot.parent;
  while (
    (isNodeOfType(parent, "SequenceExpression") && parent.expressions.at(-1) === expressionRoot) ||
    (isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === expressionRoot || parent.alternate === expressionRoot)) ||
    (isNodeOfType(parent, "LogicalExpression") && parent.right === expressionRoot)
  ) {
    expressionRoot = findTransparentExpressionRoot(parent);
    parent = expressionRoot.parent;
  }
  if (
    (isNodeOfType(parent, "SequenceExpression") && parent.expressions.at(-1) !== expressionRoot) ||
    (isNodeOfType(parent, "UnaryExpression") && parent.operator === "void")
  ) {
    return false;
  }
  if (isNodeOfType(parent, "ExpressionStatement")) return false;
  if (isNodeOfType(parent, "MemberExpression") && parent.object === expressionRoot) {
    const propertyName = getStaticPropertyName(parent);
    return propertyName === null || !ACKNOWLEDGEMENT_FIELD_NAMES.has(propertyName);
  }
  if (isNodeOfType(parent, "VariableDeclarator") && parent.init === expressionRoot) {
    if (isNodeOfType(parent.id, "ObjectPattern")) {
      return objectPatternConsumesResponse(parent.id);
    }
    if (isNodeOfType(parent.id, "Identifier")) {
      const aliasSymbol = context.scopes.symbolFor(parent.id);
      return Boolean(aliasSymbol && symbolHasConsumerRead(aliasSymbol, context, visitedSymbols));
    }
  }
  return true;
};

const resultObjectDataIsConsumed = (
  resultSymbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  for (const symbol of collectConstAliasSymbols(resultSymbol, context.scopes)) {
    for (const reference of symbol.references) {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const parent = referenceRoot.parent;
      if (isNodeOfType(parent, "MemberExpression") && parent.object === referenceRoot) {
        if (getStaticPropertyName(parent) !== "data") continue;
        if (responseExpressionIsConsumed(parent, context, new Set())) return true;
        continue;
      }
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === referenceRoot &&
        isNodeOfType(parent.id, "ObjectPattern")
      ) {
        for (const dataBinding of getPatternBindings(parent.id, "data")) {
          const dataSymbol = context.scopes.symbolFor(dataBinding);
          if (dataSymbol && symbolHasConsumerRead(dataSymbol, context)) return true;
        }
      }
    }
  }
  return false;
};

const getMutationCalls = (
  declarator: EsTreeNodeOfType<"VariableDeclarator">,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression">[] => {
  const calls: EsTreeNodeOfType<"CallExpression">[] = [];
  const collectBindingCalls = (binding: EsTreeNodeOfType<"Identifier">): void => {
    const symbol = context.scopes.symbolFor(binding);
    if (!symbol) return;
    for (const aliasSymbol of collectConstAliasSymbols(symbol, context.scopes)) {
      for (const reference of aliasSymbol.references) {
        const referenceRoot = findTransparentExpressionRoot(reference.identifier);
        const callExpression = referenceRoot.parent;
        if (
          isNodeOfType(callExpression, "CallExpression") &&
          callExpression.callee === referenceRoot
        ) {
          calls.push(callExpression);
        }
      }
    }
  };
  if (isNodeOfType(declarator.id, "Identifier")) {
    const resultSymbol = context.scopes.symbolFor(declarator.id);
    if (!resultSymbol) return calls;
    for (const symbol of collectConstAliasSymbols(resultSymbol, context.scopes)) {
      for (const reference of symbol.references) {
        const referenceRoot = findTransparentExpressionRoot(reference.identifier);
        const memberExpression = referenceRoot.parent;
        if (
          !isNodeOfType(memberExpression, "MemberExpression") ||
          memberExpression.object !== referenceRoot
        ) {
          continue;
        }
        const methodName = getStaticPropertyName(memberExpression);
        const memberRoot = findTransparentExpressionRoot(memberExpression);
        const callExpression = memberRoot.parent;
        if (methodName !== "mutate" && methodName !== "mutateAsync") continue;
        if (
          isNodeOfType(callExpression, "CallExpression") &&
          callExpression.callee === memberRoot
        ) {
          calls.push(callExpression);
          continue;
        }
        if (
          isNodeOfType(callExpression, "VariableDeclarator") &&
          callExpression.init === memberRoot &&
          isNodeOfType(callExpression.id, "Identifier")
        ) {
          collectBindingCalls(callExpression.id);
        }
      }
      for (const reference of symbol.references) {
        const referenceRoot = findTransparentExpressionRoot(reference.identifier);
        const aliasDeclarator = referenceRoot.parent;
        if (
          !isNodeOfType(aliasDeclarator, "VariableDeclarator") ||
          aliasDeclarator.init !== referenceRoot ||
          !isNodeOfType(aliasDeclarator.id, "ObjectPattern")
        ) {
          continue;
        }
        for (const propertyName of ["mutate", "mutateAsync"]) {
          for (const binding of getPatternBindings(aliasDeclarator.id, propertyName)) {
            collectBindingCalls(binding);
          }
        }
      }
    }
    return calls;
  }
  for (const propertyName of ["mutate", "mutateAsync"]) {
    for (const binding of getPatternBindings(declarator.id, propertyName)) {
      collectBindingCalls(binding);
    }
  }
  return calls;
};

const getAwaitedExpression = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): EsTreeNode | null => {
  const callRoot = findTransparentExpressionRoot(callExpression);
  const awaitExpression = callRoot.parent;
  return isNodeOfType(awaitExpression, "AwaitExpression") ? awaitExpression : null;
};

const handlerConsumesResponse = (handlerExpression: EsTreeNode, context: RuleContext): boolean => {
  const handler = resolveLocalFunction(handlerExpression, context);
  if (!handler || !isFunctionLike(handler)) return false;
  const parameter = handler.params[0];
  if (!parameter) return false;
  if (isNodeOfType(parameter, "Identifier")) {
    const symbol = context.scopes.symbolFor(parameter);
    return Boolean(symbol && symbolHasConsumerRead(symbol, context));
  }
  return isNodeOfType(parameter, "ObjectPattern") && objectPatternConsumesResponse(parameter);
};

const thenHandlerConsumesResponse = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const callRoot = findTransparentExpressionRoot(callExpression);
  const memberExpression = callRoot.parent;
  if (
    !isNodeOfType(memberExpression, "MemberExpression") ||
    memberExpression.object !== callRoot ||
    getStaticPropertyName(memberExpression) !== "then"
  ) {
    return false;
  }
  const memberRoot = findTransparentExpressionRoot(memberExpression);
  const thenCall = memberRoot.parent;
  const handler =
    isNodeOfType(thenCall, "CallExpression") && thenCall.callee === memberRoot
      ? thenCall.arguments[0]
      : null;
  return Boolean(handler && handlerConsumesResponse(handler, context));
};

const resolveOptionsObject = (
  optionsExpression: EsTreeNode | null | undefined,
  context: RuleContext,
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  if (!optionsExpression) return null;
  const options = stripParenExpression(optionsExpression);
  if (isNodeOfType(options, "ObjectExpression")) return options;
  if (!isNodeOfType(options, "Identifier")) return null;
  const symbol = resolveConstIdentifierAlias(options, context.scopes);
  if (!symbol?.initializer) return null;
  const resolved = stripParenExpression(symbol.initializer);
  return isNodeOfType(resolved, "ObjectExpression") ? resolved : null;
};

const optionsConsumeResponse = (
  optionsExpression: EsTreeNode | null | undefined,
  context: RuleContext,
): boolean => {
  const options = resolveOptionsObject(optionsExpression, context);
  if (!options) return false;
  for (const property of options.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      !["onSettled", "onSuccess"].includes(
        getStaticPropertyKeyName(property, { allowComputedString: true }) ?? "",
      )
    ) {
      continue;
    }
    if (handlerConsumesResponse(property.value, context)) return true;
  }
  return false;
};

const collectDominatingStatements = (node: EsTreeNode): EsTreeNode[] => {
  const statements: EsTreeNode[] = [];
  let child: EsTreeNode = node;
  let parent = child.parent;
  while (parent && !isFunctionLike(parent)) {
    if (isNodeOfType(parent, "BlockStatement")) {
      const childIndex = parent.body.findIndex((statement) => statement === child);
      if (childIndex >= 0) statements.push(...parent.body.slice(0, childIndex));
    }
    child = parent;
    parent = child.parent;
  }
  return statements.sort((left, right) => left.range[0] - right.range[0]);
};

const getRefCurrentSymbol = (
  expression: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => resolveReactRefSymbol(expression, context.scopes);

const getRefGuardSymbolForValue = (
  test: EsTreeNode,
  guardedValue: boolean,
  context: RuleContext,
): SymbolDescriptor | null => {
  const candidate = stripParenExpression(test);
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "!") {
    return guardedValue
      ? null
      : getRefCurrentSymbol(stripParenExpression(candidate.argument), context);
  }
  const directSymbol = getRefCurrentSymbol(candidate, context);
  if (directSymbol) return guardedValue ? directSymbol : null;
  if (
    !isNodeOfType(candidate, "BinaryExpression") ||
    !["==", "===", "!=", "!=="].includes(candidate.operator)
  ) {
    return null;
  }
  const leftValue = stripParenExpression(candidate.left);
  const rightValue = stripParenExpression(candidate.right);
  const leftSymbol = getRefCurrentSymbol(leftValue, context);
  const rightSymbol = getRefCurrentSymbol(rightValue, context);
  const refSymbol = leftSymbol ?? rightSymbol;
  const booleanValue = leftSymbol ? rightValue : rightSymbol ? leftValue : null;
  if (!refSymbol || !isNodeOfType(booleanValue, "Literal")) return null;
  if (typeof booleanValue.value !== "boolean") return null;
  const isEquality = ["==", "==="].includes(candidate.operator);
  const valueWhenTestPasses = isEquality ? booleanValue.value : !booleanValue.value;
  return valueWhenTestPasses === guardedValue ? refSymbol : null;
};

const getAssignedTrueRefSymbol = (
  statement: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const expression = stripParenExpression(statement.expression);
  const assignedValue = isNodeOfType(expression, "AssignmentExpression")
    ? stripParenExpression(expression.right)
    : null;
  if (
    !isNodeOfType(expression, "AssignmentExpression") ||
    expression.operator !== "=" ||
    !isNodeOfType(assignedValue, "Literal") ||
    assignedValue.value !== true
  ) {
    return null;
  }
  return getRefCurrentSymbol(stripParenExpression(expression.left), context);
};

const refSymbolHasResettingWrite = (refSymbol: SymbolDescriptor, context: RuleContext): boolean =>
  collectConstAliasSymbols(refSymbol, context.scopes).some((symbol) =>
    symbol.references.some((reference) => {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const memberExpression = referenceRoot.parent;
      if (
        !isNodeOfType(memberExpression, "MemberExpression") ||
        memberExpression.object !== referenceRoot ||
        getStaticPropertyName(memberExpression) !== "current"
      ) {
        return false;
      }
      const memberRoot = findTransparentExpressionRoot(memberExpression);
      const parent = memberRoot.parent;
      if (isNodeOfType(parent, "UpdateExpression") && parent.argument === memberRoot) return true;
      if (!isNodeOfType(parent, "AssignmentExpression") || parent.left !== memberRoot) {
        return false;
      }
      const assignedValue = stripParenExpression(parent.right);
      return !(
        parent.operator === "=" &&
        isNodeOfType(assignedValue, "Literal") &&
        assignedValue.value === true
      );
    }),
  );

const pathHasRunOnceRefLatch = (pathNode: EsTreeNode, context: RuleContext): boolean => {
  const statements = collectDominatingStatements(pathNode);
  const guardedAt = new Map<number, number>();
  let branchChild = pathNode;
  let branchParent = branchChild.parent;
  while (branchParent && !isFunctionLike(branchParent)) {
    if (isNodeOfType(branchParent, "IfStatement") && branchParent.consequent === branchChild) {
      const guardedSymbol = getRefGuardSymbolForValue(branchParent.test, false, context);
      if (guardedSymbol) guardedAt.set(guardedSymbol.id, branchChild.range[0]);
    }
    branchChild = branchParent;
    branchParent = branchChild.parent;
  }
  for (const statement of statements) {
    if (isNodeOfType(statement, "IfStatement") && isEarlyExitStatement(statement.consequent)) {
      const guardedSymbol = getRefGuardSymbolForValue(statement.test, true, context);
      if (guardedSymbol) guardedAt.set(guardedSymbol.id, statement.range[0]);
    }
    const assignedSymbol = getAssignedTrueRefSymbol(statement, context);
    if (
      assignedSymbol &&
      (guardedAt.get(assignedSymbol.id) ?? Number.POSITIVE_INFINITY) < statement.range[0] &&
      !refSymbolHasResettingWrite(assignedSymbol, context)
    ) {
      return true;
    }
  }
  return false;
};

const expressionMatchesStatusTarget = (
  expression: EsTreeNode,
  target: StatusTarget,
  context: RuleContext,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    return (
      target.propertyName === null && context.scopes.symbolFor(candidate)?.id === target.symbolId
    );
  }
  if (!isNodeOfType(candidate, "MemberExpression")) return false;
  const object = stripParenExpression(candidate.object);
  return Boolean(
    target.propertyName !== null &&
    getStaticPropertyName(candidate) === target.propertyName &&
    isNodeOfType(object, "Identifier") &&
    context.scopes.symbolFor(object)?.id === target.symbolId,
  );
};

const testPositivelyMatchesStatusTarget = (
  test: EsTreeNode,
  target: StatusTarget,
  context: RuleContext,
): boolean => {
  const candidate = stripParenExpression(test);
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "!") {
    return testNegativelyMatchesStatusTarget(candidate.argument, target, context);
  }
  if (expressionMatchesStatusTarget(candidate, target, context)) {
    return target.sourcePropertyName === "isSuccess";
  }
  if (!isNodeOfType(candidate, "BinaryExpression")) {
    return false;
  }
  const leftMatches = expressionMatchesStatusTarget(candidate.left, target, context);
  const rightMatches = expressionMatchesStatusTarget(candidate.right, target, context);
  const otherOperand = leftMatches ? candidate.right : rightMatches ? candidate.left : null;
  const other = otherOperand ? stripParenExpression(otherOperand) : null;
  if (!other) return false;
  if (target.sourcePropertyName === "data") {
    return ["!=", "!=="].includes(candidate.operator) && isNullishExpression(other);
  }
  if (!isNodeOfType(other, "Literal") || !["==", "==="].includes(candidate.operator)) {
    return false;
  }
  if (target.sourcePropertyName === "status") return other.value === "success";
  return other.value === true;
};

const testNegativelyMatchesStatusTarget = (
  test: EsTreeNode,
  target: StatusTarget,
  context: RuleContext,
): boolean => {
  const candidate = stripParenExpression(test);
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "!") {
    return testPositivelyMatchesStatusTarget(candidate.argument, target, context);
  }
  if (!isNodeOfType(candidate, "BinaryExpression")) return false;
  const leftMatches = expressionMatchesStatusTarget(candidate.left, target, context);
  const rightMatches = expressionMatchesStatusTarget(candidate.right, target, context);
  const otherOperand = leftMatches ? candidate.right : rightMatches ? candidate.left : null;
  if (!otherOperand) return false;
  const other = stripParenExpression(otherOperand);
  if (target.sourcePropertyName === "data") {
    return ["==", "==="].includes(candidate.operator) && isNullishExpression(other);
  }
  if (!isNodeOfType(other, "Literal")) return false;
  if (target.sourcePropertyName === "status") {
    return ["!=", "!=="].includes(candidate.operator) && other.value === "success";
  }
  return (
    (["==", "==="].includes(candidate.operator) && other.value === false) ||
    (["!=", "!=="].includes(candidate.operator) && other.value === true)
  );
};

const pathHasEnclosingNegativeStatusGuard = (
  pathNode: EsTreeNode,
  statusTargets: StatusTarget[],
  context: RuleContext,
): boolean => {
  let branchChild = pathNode;
  let branchParent = branchChild.parent;
  while (branchParent && !isFunctionLike(branchParent)) {
    const currentBranchParent = branchParent;
    if (
      isNodeOfType(currentBranchParent, "IfStatement") &&
      currentBranchParent.consequent === branchChild &&
      statusTargets.some((target) =>
        testNegativelyMatchesStatusTarget(currentBranchParent.test, target, context),
      )
    ) {
      return true;
    }
    branchChild = currentBranchParent;
    branchParent = branchChild.parent;
  }
  return false;
};

const invocationHasDominatingStatusGuard = (
  invocation: EffectInvocation,
  statusTargets: StatusTarget[],
  context: RuleContext,
): boolean =>
  invocation.pathNodes.some(
    (pathNode) =>
      pathHasEnclosingNegativeStatusGuard(pathNode, statusTargets, context) ||
      collectDominatingStatements(pathNode).some(
        (statement) =>
          isNodeOfType(statement, "IfStatement") &&
          isEarlyExitStatement(statement.consequent) &&
          statusTargets.some((target) =>
            testPositivelyMatchesStatusTarget(statement.test, target, context),
          ),
      ),
  );

const getStatusTargets = (
  declarator: EsTreeNodeOfType<"VariableDeclarator">,
  context: RuleContext,
): StatusTarget[] => {
  if (isNodeOfType(declarator.id, "Identifier")) {
    const resultSymbol = context.scopes.symbolFor(declarator.id);
    return resultSymbol
      ? ["data", "isSuccess", "status"].flatMap((sourcePropertyName) =>
          collectConstAliasSymbols(resultSymbol, context.scopes).map((symbol) => ({
            symbolId: symbol.id,
            propertyName: sourcePropertyName,
            sourcePropertyName,
          })),
        )
      : [];
  }
  const targets: StatusTarget[] = [];
  for (const propertyName of ["data", "isSuccess", "status"]) {
    for (const binding of getPatternBindings(declarator.id, propertyName)) {
      const symbol = context.scopes.symbolFor(binding);
      if (!symbol) continue;
      for (const aliasSymbol of collectConstAliasSymbols(symbol, context.scopes)) {
        targets.push({
          symbolId: aliasSymbol.id,
          propertyName: null,
          sourcePropertyName: propertyName,
        });
      }
    }
  }
  return targets;
};

const resultDataIsConsumed = (
  declarator: EsTreeNodeOfType<"VariableDeclarator">,
  context: RuleContext,
): boolean => {
  if (isNodeOfType(declarator.id, "Identifier")) {
    const resultSymbol = context.scopes.symbolFor(declarator.id);
    return Boolean(resultSymbol && resultObjectDataIsConsumed(resultSymbol, context));
  }
  return getPatternBindings(declarator.id, "data").some((binding) => {
    const symbol = context.scopes.symbolFor(binding);
    return Boolean(symbol && symbolHasConsumerRead(symbol, context));
  });
};

const mutationResultIsConsumedInCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const awaitedExpression = getAwaitedExpression(callExpression);
  if (awaitedExpression) {
    return responseExpressionIsConsumed(awaitedExpression, context, new Set());
  }
  return (
    thenHandlerConsumesResponse(callExpression, context) ||
    optionsConsumeResponse(callExpression.arguments[1], context)
  );
};

const getMutationFunctionIntentName = (
  initializer: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): string | null => {
  const options = resolveOptionsObject(initializer.arguments[0], context);
  if (options) {
    for (const property of options.properties) {
      if (
        !isNodeOfType(property, "Property") ||
        getStaticPropertyKeyName(property, { allowComputedString: true }) !== "mutationFn"
      ) {
        continue;
      }
      const mutationFunction = stripParenExpression(property.value);
      if (isNodeOfType(mutationFunction, "Identifier")) return mutationFunction.name;
      if (isNodeOfType(mutationFunction, "MemberExpression")) {
        return getStaticPropertyName(mutationFunction);
      }
      return isFunctionLike(mutationFunction) ? getFunctionBindingName(mutationFunction) : null;
    }
    return null;
  }
  const mutationFunction = initializer.arguments[0];
  if (!mutationFunction) return null;
  const candidate = stripParenExpression(mutationFunction);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = context.scopes.symbolFor(candidate);
    if (symbol?.kind === "function") return candidate.name;
    return symbol?.initializer && isFunctionLike(stripParenExpression(symbol.initializer))
      ? candidate.name
      : null;
  }
  return isFunctionLike(candidate) ? getFunctionBindingName(candidate) : null;
};

const declaratorHasReadIntent = (
  declarator: EsTreeNodeOfType<"VariableDeclarator">,
  initializer: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  if (hasReadIntentName(getCalleeName(initializer))) return true;
  if (hasReadIntentName(getMutationFunctionIntentName(initializer, context))) return true;
  if (isNodeOfType(declarator.id, "Identifier")) return hasReadIntentName(declarator.id.name);
  return ["mutate", "mutateAsync"].some((propertyName) =>
    getPatternBindings(declarator.id, propertyName).some((binding) =>
      hasReadIntentName(binding.name),
    ),
  );
};

export const queryNoMutationInEffectAsRead = defineRule({
  id: "query-no-mutation-in-effect-as-read",
  title: "Mutation driven from an effect as a read",
  tags: ["test-noise"],
  requires: ["tanstack-query"],
  severity: "warn",
  recommendation:
    "Use `useQuery` with a `queryKey` and `enabled` for reads started by an effect so the result is cached and deduplicated.",
  create: (context: RuleContext) => ({
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!node.init) return;
      const initializer = stripParenExpression(node.init);
      if (
        !isNodeOfType(initializer, "CallExpression") ||
        resolveTanstackMutationHookNameFromInitializer(initializer, context.scopes) !==
          "useMutation" ||
        !declaratorHasReadIntent(node, initializer, context)
      ) {
        return;
      }

      const calls = getMutationCalls(node, context);
      const statusTargets = getStatusTargets(node, context);
      const hasSharedDataConsumer = resultDataIsConsumed(node, context);
      const hasOptionsConsumer = optionsConsumeResponse(initializer.arguments[0], context);

      for (const call of calls) {
        const invocations = collectEffectInvocations(call, context);
        if (invocations.length === 0) continue;
        const activeInvocations = invocations.filter(
          (invocation) =>
            !invocation.pathNodes.some((pathNode) => pathHasRunOnceRefLatch(pathNode, context)) &&
            !invocationHasDominatingStatusGuard(invocation, statusTargets, context),
        );
        if (activeInvocations.length === 0) continue;
        if (
          !hasSharedDataConsumer &&
          !hasOptionsConsumer &&
          !mutationResultIsConsumedInCall(call, context)
        ) {
          continue;
        }
        context.report({
          node: initializer,
          message:
            "This `useMutation` call is driven from an effect and its response is consumed as read data, so the result is neither cached nor deduplicated like a query.",
        });
        return;
      }
    },
  }),
});
