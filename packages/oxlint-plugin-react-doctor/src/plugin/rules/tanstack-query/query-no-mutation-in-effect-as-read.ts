import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { collectConstAliasSymbols } from "../../utils/collect-const-alias-symbols.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getFunctionBindingSymbols } from "../../utils/get-function-binding-symbols.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNullishExpression } from "../../utils/is-nullish-expression.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveReactRefSymbol } from "../../utils/react-ref-origin.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { tokenizeIdentifierWords } from "../../utils/tokenize-identifier-words.js";
import { resolveTanstackQueryHookNameFromInitializer } from "./utils/resolve-tanstack-query-hook-name.js";

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

const isEffectCallbackReference = (identifier: EsTreeNode): boolean => {
  let callbackValue = findTransparentExpressionRoot(identifier);
  while (
    (isNodeOfType(callbackValue.parent, "ConditionalExpression") &&
      callbackValue.parent.test !== callbackValue) ||
    isNodeOfType(callbackValue.parent, "LogicalExpression")
  ) {
    callbackValue = findTransparentExpressionRoot(callbackValue.parent);
  }
  const callExpression = callbackValue.parent;
  return Boolean(
    isNodeOfType(callExpression, "CallExpression") &&
    callExpression.arguments[0] === callbackValue &&
    isHookCall(callExpression, EFFECT_HOOK_NAMES),
  );
};

const collectEffectInvocations = (
  node: EsTreeNode,
  context: RuleContext,
  visitedFunctions: Set<EsTreeNode> = new Set(),
): EffectInvocation[] => {
  const functionNode = findEnclosingFunction(node);
  if (!functionNode || visitedFunctions.has(functionNode)) return [];
  visitedFunctions.add(functionNode);

  const directCall = functionNode.parent;
  if (
    isNodeOfType(directCall, "CallExpression") &&
    stripParenExpression(directCall.callee) === functionNode
  ) {
    return collectEffectInvocations(directCall, context, visitedFunctions).map((invocation) => ({
      callback: invocation.callback,
      pathNodes: [node, ...invocation.pathNodes],
    }));
  }

  const functionSymbol = findFunctionSymbol(functionNode, context);
  if (functionSymbol) {
    const functionSymbols = collectConstAliasSymbols(functionSymbol, context.scopes);
    for (const symbol of functionSymbols) {
      for (const reference of symbol.references) {
        if (isEffectCallbackReference(reference.identifier)) {
          return [{ callback: functionNode, pathNodes: [node] }];
        }
      }
    }
    const invocations: EffectInvocation[] = [];
    for (const symbol of functionSymbols) {
      for (const reference of symbol.references) {
        const callSite = reference.identifier.parent;
        if (!isNodeOfType(callSite, "CallExpression") || callSite.callee !== reference.identifier) {
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

  const enclosingCall = functionNode.parent;
  if (
    isNodeOfType(enclosingCall, "CallExpression") &&
    enclosingCall.arguments[0] === functionNode &&
    isHookCall(enclosingCall, EFFECT_HOOK_NAMES)
  ) {
    return [{ callback: functionNode, pathNodes: [node] }];
  }
  return [];
};

const isInEffectDependencyArray = (node: EsTreeNode): boolean => {
  let current: EsTreeNode = node;
  let parent = current.parent;
  while (parent && !isFunctionLike(parent)) {
    if (isNodeOfType(parent, "ArrayExpression")) {
      const callExpression = parent.parent;
      return Boolean(
        isNodeOfType(callExpression, "CallExpression") &&
        callExpression.arguments[1] === parent &&
        isHookCall(callExpression, EFFECT_HOOK_NAMES),
      );
    }
    current = parent;
    parent = current.parent;
  }
  return false;
};

const isGuardOnlyReference = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") return true;
  if (isNodeOfType(parent, "LogicalExpression") && parent.left === node) return true;
  if (isNodeOfType(parent, "ConditionalExpression") && parent.test === node) return true;
  if (
    (isNodeOfType(parent, "IfStatement") || isNodeOfType(parent, "WhileStatement")) &&
    parent.test === node
  ) {
    return true;
  }
  if (
    isNodeOfType(parent, "BinaryExpression") &&
    ["==", "!=", "===", "!=="].includes(parent.operator)
  ) {
    const otherOperand = parent.left === node ? parent.right : parent.left;
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
  if (isInEffectDependencyArray(expression) || isGuardOnlyReference(expression)) return false;
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
      const parent = reference.identifier.parent;
      if (isNodeOfType(parent, "MemberExpression") && parent.object === reference.identifier) {
        if (getStaticPropertyName(parent) !== "data") continue;
        if (responseExpressionIsConsumed(parent, context, new Set())) return true;
        continue;
      }
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === reference.identifier &&
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
  if (isNodeOfType(declarator.id, "Identifier")) {
    const resultSymbol = context.scopes.symbolFor(declarator.id);
    if (!resultSymbol) return calls;
    for (const symbol of collectConstAliasSymbols(resultSymbol, context.scopes)) {
      for (const reference of symbol.references) {
        const memberExpression = reference.identifier.parent;
        if (
          !isNodeOfType(memberExpression, "MemberExpression") ||
          memberExpression.object !== reference.identifier
        ) {
          continue;
        }
        const methodName = getStaticPropertyName(memberExpression);
        const callExpression = memberExpression.parent;
        if (
          (methodName === "mutate" || methodName === "mutateAsync") &&
          isNodeOfType(callExpression, "CallExpression") &&
          callExpression.callee === memberExpression
        ) {
          calls.push(callExpression);
        }
      }
    }
    return calls;
  }
  for (const propertyName of ["mutate", "mutateAsync"]) {
    for (const binding of getPatternBindings(declarator.id, propertyName)) {
      const symbol = context.scopes.symbolFor(binding);
      if (!symbol) continue;
      for (const aliasSymbol of collectConstAliasSymbols(symbol, context.scopes)) {
        for (const reference of aliasSymbol.references) {
          const callExpression = reference.identifier.parent;
          if (
            isNodeOfType(callExpression, "CallExpression") &&
            callExpression.callee === reference.identifier
          ) {
            calls.push(callExpression);
          }
        }
      }
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
  const thenCall = memberExpression.parent;
  const handler = isNodeOfType(thenCall, "CallExpression") ? thenCall.arguments[0] : null;
  return Boolean(handler && handlerConsumesResponse(handler, context));
};

const resolveOptionsObject = (
  initializer: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  const optionsArgument = initializer.arguments[0];
  if (!optionsArgument) return null;
  const options = stripParenExpression(optionsArgument);
  if (isNodeOfType(options, "ObjectExpression")) return options;
  if (!isNodeOfType(options, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(options);
  if (!symbol?.initializer) return null;
  const resolved = stripParenExpression(symbol.initializer);
  return isNodeOfType(resolved, "ObjectExpression") ? resolved : null;
};

const onSuccessConsumesResponse = (
  initializer: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const options = resolveOptionsObject(initializer, context);
  if (!options) return false;
  for (const property of options.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      getStaticPropertyKeyName(property, { allowComputedString: true }) !== "onSuccess"
    ) {
      continue;
    }
    return handlerConsumesResponse(property.value, context);
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

const getPositiveRefGuardSymbol = (
  test: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  const candidate = stripParenExpression(test);
  const directSymbol = getRefCurrentSymbol(candidate, context);
  if (directSymbol) return directSymbol;
  if (!isNodeOfType(candidate, "BinaryExpression") || !["==", "==="].includes(candidate.operator)) {
    return null;
  }
  const leftSymbol = getRefCurrentSymbol(candidate.left, context);
  const rightSymbol = getRefCurrentSymbol(candidate.right, context);
  if (leftSymbol && isNodeOfType(candidate.right, "Literal") && candidate.right.value === true) {
    return leftSymbol;
  }
  if (rightSymbol && isNodeOfType(candidate.left, "Literal") && candidate.left.value === true) {
    return rightSymbol;
  }
  return null;
};

const getAssignedTrueRefSymbol = (
  statement: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const expression = stripParenExpression(statement.expression);
  if (
    !isNodeOfType(expression, "AssignmentExpression") ||
    expression.operator !== "=" ||
    !isNodeOfType(expression.right, "Literal") ||
    expression.right.value !== true
  ) {
    return null;
  }
  return getRefCurrentSymbol(expression.left, context);
};

const refSymbolHasResettingWrite = (refSymbol: SymbolDescriptor, context: RuleContext): boolean =>
  collectConstAliasSymbols(refSymbol, context.scopes).some((symbol) =>
    symbol.references.some((reference) => {
      const memberExpression = reference.identifier.parent;
      if (
        !isNodeOfType(memberExpression, "MemberExpression") ||
        memberExpression.object !== reference.identifier ||
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
      return !(
        parent.operator === "=" &&
        isNodeOfType(parent.right, "Literal") &&
        parent.right.value === true
      );
    }),
  );

const pathHasRunOnceRefLatch = (pathNode: EsTreeNode, context: RuleContext): boolean => {
  const statements = collectDominatingStatements(pathNode);
  const guardedAt = new Map<number, number>();
  for (const statement of statements) {
    if (isNodeOfType(statement, "IfStatement") && isEarlyExitStatement(statement.consequent)) {
      const guardedSymbol = getPositiveRefGuardSymbol(statement.test, context);
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
  if (expressionMatchesStatusTarget(candidate, target, context)) {
    return target.sourcePropertyName === "isSuccess";
  }
  if (!isNodeOfType(candidate, "BinaryExpression")) {
    return false;
  }
  const leftMatches = expressionMatchesStatusTarget(candidate.left, target, context);
  const rightMatches = expressionMatchesStatusTarget(candidate.right, target, context);
  const other = leftMatches ? candidate.right : rightMatches ? candidate.left : null;
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

const invocationHasDominatingStatusGuard = (
  invocation: EffectInvocation,
  statusTargets: StatusTarget[],
  context: RuleContext,
): boolean =>
  invocation.pathNodes.some((pathNode) =>
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
  return thenHandlerConsumesResponse(callExpression, context);
};

const declaratorHasReadIntent = (
  declarator: EsTreeNodeOfType<"VariableDeclarator">,
  initializer: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  if (hasReadIntentName(getCalleeName(initializer))) return true;
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
        resolveTanstackQueryHookNameFromInitializer(initializer, context.scopes) !==
          "useMutation" ||
        !declaratorHasReadIntent(node, initializer)
      ) {
        return;
      }

      const calls = getMutationCalls(node, context);
      const statusTargets = getStatusTargets(node, context);
      const hasSharedDataConsumer = resultDataIsConsumed(node, context);
      const hasOnSuccessConsumer = onSuccessConsumesResponse(initializer, context);

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
          !hasOnSuccessConsumer &&
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
