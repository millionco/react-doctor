import { FETCH_CALLEE_NAMES, FETCH_MEMBER_OBJECTS } from "../../constants/library.js";
import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { collectEffectInvokedFunctions } from "../../utils/collect-effect-invoked-functions.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isSetterCall } from "../../utils/is-setter-call.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import { statementAlwaysExits } from "../../utils/statement-always-exits.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const IMPORT_INITIALIZER_TYPES = new Set([
  "ImportSpecifier",
  "ImportDefaultSpecifier",
  "ImportNamespaceSpecifier",
]);

const CANCELLATION_FLAG_NAME_PATTERN = /cancel|ignore/i;
const PROMISE_CONTINUATION_METHOD_NAMES = new Set(["then", "catch", "finally"]);

// `const fetch = useCallback(...)` (demo mocks, wrappers) shadows the global;
// the call is not a network fetch by the library the rule targets. A binding
// that IS an import (ky, got, a fetch wrapper module) still counts.
const isShadowedByLocalBinding = (identifier: EsTreeNode): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding) return false;
  const initializer = binding.initializer;
  if (initializer && IMPORT_INITIALIZER_TYPES.has(initializer.type)) return false;
  return true;
};

const isRealFetchCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (isNodeOfType(node.callee, "Identifier") && FETCH_CALLEE_NAMES.has(node.callee.name)) {
    return !isShadowedByLocalBinding(node.callee);
  }
  return (
    isNodeOfType(node.callee, "MemberExpression") &&
    isNodeOfType(node.callee.object, "Identifier") &&
    FETCH_MEMBER_OBJECTS.has(node.callee.object.name) &&
    !isShadowedByLocalBinding(node.callee.object)
  );
};

const isXmlHttpRequestConstruction = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "NewExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  node.callee.name === "XMLHttpRequest";

const isNetworkRequest = (node: EsTreeNode): boolean =>
  isRealFetchCall(node) || isXmlHttpRequestConstruction(node);

const resolveLocalFunction = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): EsTreeNode | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (isFunctionLike(unwrappedExpression)) return unwrappedExpression;
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const initializer = context.scopes.symbolFor(unwrappedExpression)?.initializer;
  if (!initializer) return null;
  const unwrappedInitializer = stripParenExpression(initializer);
  return isFunctionLike(unwrappedInitializer) ? unwrappedInitializer : null;
};

const collectEffectAnalysisFunctions = (
  effectCallback: EsTreeNode,
  context: RuleContext,
): Set<EsTreeNode> => {
  const analysisFunctions = new Set<EsTreeNode>();
  const pendingFunctions: EsTreeNode[] = [];
  const enqueueFunction = (functionNode: EsTreeNode): void => {
    for (const invokedFunction of collectEffectInvokedFunctions(functionNode)) {
      if (analysisFunctions.has(invokedFunction)) continue;
      analysisFunctions.add(invokedFunction);
      pendingFunctions.push(invokedFunction);
    }
  };

  enqueueFunction(effectCallback);
  while (pendingFunctions.length > 0) {
    const currentFunction = pendingFunctions.pop();
    if (!currentFunction) break;
    walkAst(currentFunction, (child) => {
      if (child !== currentFunction && isFunctionLike(child)) return false;
      if (!isNodeOfType(child, "CallExpression")) return;

      const calledFunction = resolveLocalFunction(child.callee, context);
      if (calledFunction) enqueueFunction(calledFunction);
      for (const callArgument of child.arguments ?? []) {
        const callbackFunction = resolveLocalFunction(callArgument, context);
        if (callbackFunction) enqueueFunction(callbackFunction);
      }
    });
  }
  return analysisFunctions;
};

const collectNodesFromAnalysisFunctions = (
  analysisFunctions: ReadonlySet<EsTreeNode>,
  predicate: (node: EsTreeNode) => boolean,
): EsTreeNode[] => {
  const nodes: EsTreeNode[] = [];
  const seenNodes = new Set<EsTreeNode>();
  for (const analysisFunction of analysisFunctions) {
    walkAst(analysisFunction, (child) => {
      if (child !== analysisFunction && isFunctionLike(child)) return false;
      if (!seenNodes.has(child) && predicate(child)) {
        seenNodes.add(child);
        nodes.push(child);
      }
    });
  }
  return nodes;
};

const findEffectCleanupFunction = (callback: EsTreeNode): EsTreeNode | null => {
  if (!isFunctionLike(callback)) return null;
  const body = callback.body;
  if (isFunctionLike(body)) return body;
  let cleanup: EsTreeNode | null = null;
  walkAst(body, (child) => {
    if (child !== body && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "ReturnStatement") &&
      child.argument &&
      isFunctionLike(child.argument)
    ) {
      cleanup = child.argument;
    }
  });
  return cleanup;
};

const collectEffectCancellationFlagKeys = (
  effectCallback: EsTreeNode,
  context: RuleContext,
): Set<string> => {
  const flagKeys = new Set<string>();
  if (!isFunctionLike(effectCallback)) return flagKeys;
  const body = effectCallback.body;
  if (!isNodeOfType(body, "BlockStatement")) return flagKeys;
  for (const statement of body.body ?? []) {
    if (!isNodeOfType(statement, "VariableDeclaration") || statement.kind !== "let") continue;
    for (const declarator of statement.declarations ?? []) {
      if (
        !isNodeOfType(declarator, "VariableDeclarator") ||
        !isNodeOfType(declarator.id, "Identifier")
      ) {
        continue;
      }
      const initializer = declarator.init;
      if (
        isNodeOfType(initializer, "Literal") &&
        initializer.value === false &&
        CANCELLATION_FLAG_NAME_PATTERN.test(declarator.id.name)
      ) {
        const flagKey = resolveExpressionKey(declarator.id, context);
        if (flagKey) flagKeys.add(flagKey);
      }
    }
  }
  return flagKeys;
};

const resolveConstValue = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): EsTreeNode | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return unwrappedExpression;
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id)
  ) {
    return unwrappedExpression;
  }
  visitedSymbolIds.add(symbol.id);
  return resolveConstValue(symbol.initializer, context, visitedSymbolIds);
};

const resolveRequestAbortControllerKey = (
  request: EsTreeNode,
  context: RuleContext,
): string | null => {
  if (isNodeOfType(request, "NewExpression")) {
    const declarator = request.parent;
    return isNodeOfType(declarator, "VariableDeclarator") && declarator.init === request
      ? resolveExpressionKey(declarator.id, context)
      : null;
  }
  if (!isNodeOfType(request, "CallExpression")) return null;
  for (const requestArgument of request.arguments ?? []) {
    const options = resolveConstValue(requestArgument, context);
    if (!isNodeOfType(options, "ObjectExpression")) continue;
    for (const property of options.properties ?? []) {
      if (
        !isNodeOfType(property, "Property") ||
        getStaticPropertyKeyName(property, { allowComputedString: true }) !== "signal"
      ) {
        continue;
      }
      const signalKey = resolveExpressionKey(property.value, context);
      return signalKey?.endsWith(".signal") ? signalKey.slice(0, -".signal".length) : null;
    }
  }
  return null;
};

const collectCleanupAbortedControllerKeys = (
  cleanup: EsTreeNode,
  context: RuleContext,
): Set<string> => {
  const controllerKeys = new Set<string>();
  walkAst(cleanup, (child) => {
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression") &&
      !child.callee.computed &&
      isNodeOfType(child.callee.property, "Identifier") &&
      child.callee.property.name === "abort"
    ) {
      const controllerKey = resolveExpressionKey(child.callee.object, context);
      if (controllerKey) controllerKeys.add(controllerKey);
    }
  });
  return controllerKeys;
};

const collectCleanupAssignedCancellationFlagKeys = (
  cleanup: EsTreeNode,
  cancellationFlagKeys: ReadonlySet<string>,
  context: RuleContext,
): Set<string> => {
  const assignedFlagKeys = new Set<string>();
  walkAst(cleanup, (child) => {
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      isNodeOfType(child.right, "Literal") &&
      child.right.value === true
    ) {
      const assignedKey = resolveExpressionKey(child.left, context);
      if (assignedKey && cancellationFlagKeys.has(assignedKey)) {
        assignedFlagKeys.add(assignedKey);
      }
    }
  });
  return assignedFlagKeys;
};

const readCancellationCondition = (
  expression: EsTreeNode,
  cancellationFlagKey: string,
  context: RuleContext,
): boolean | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (resolveExpressionKey(unwrappedExpression, context) === cancellationFlagKey) return true;
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "!"
  ) {
    const argumentResult = readCancellationCondition(
      unwrappedExpression.argument,
      cancellationFlagKey,
      context,
    );
    return argumentResult === null ? null : !argumentResult;
  }
  if (!isNodeOfType(unwrappedExpression, "BinaryExpression")) return null;
  const leftResult = readCancellationCondition(
    unwrappedExpression.left,
    cancellationFlagKey,
    context,
  );
  const rightResult = readCancellationCondition(
    unwrappedExpression.right,
    cancellationFlagKey,
    context,
  );
  const leftBoolean =
    isNodeOfType(unwrappedExpression.left, "Literal") &&
    typeof unwrappedExpression.left.value === "boolean"
      ? unwrappedExpression.left.value
      : null;
  const rightBoolean =
    isNodeOfType(unwrappedExpression.right, "Literal") &&
    typeof unwrappedExpression.right.value === "boolean"
      ? unwrappedExpression.right.value
      : null;
  const comparedCancellationValue =
    leftResult !== null && rightBoolean !== null
      ? rightBoolean
      : rightResult !== null && leftBoolean !== null
        ? leftBoolean
        : null;
  if (comparedCancellationValue === null) return null;
  if (unwrappedExpression.operator === "===" || unwrappedExpression.operator === "==") {
    return comparedCancellationValue;
  }
  if (unwrappedExpression.operator === "!==" || unwrappedExpression.operator === "!=") {
    return !comparedCancellationValue;
  }
  return null;
};

const isCompletionSinkInsideCancellationGuard = (
  completionSink: EsTreeNode,
  cancellationFlagKey: string,
  context: RuleContext,
): boolean => {
  let currentNode = completionSink;
  let parentNode = currentNode.parent;
  while (parentNode) {
    if (isFunctionLike(parentNode)) return false;
    if (isNodeOfType(parentNode, "IfStatement")) {
      const cancellationResult = readCancellationCondition(
        parentNode.test,
        cancellationFlagKey,
        context,
      );
      if (currentNode === parentNode.consequent && cancellationResult === false) return true;
      if (currentNode === parentNode.alternate && cancellationResult === true) return true;
    }
    if (isNodeOfType(parentNode, "ConditionalExpression")) {
      const cancellationResult = readCancellationCondition(
        parentNode.test,
        cancellationFlagKey,
        context,
      );
      if (currentNode === parentNode.consequent && cancellationResult === false) return true;
      if (currentNode === parentNode.alternate && cancellationResult === true) return true;
    }
    if (isNodeOfType(parentNode, "LogicalExpression") && currentNode === parentNode.right) {
      const cancellationResult = readCancellationCondition(
        parentNode.left,
        cancellationFlagKey,
        context,
      );
      if (parentNode.operator === "&&" && cancellationResult === false) return true;
      if (parentNode.operator === "||" && cancellationResult === true) return true;
    }
    currentNode = parentNode;
    parentNode = currentNode.parent;
  }
  return false;
};

const isCompletionSinkAfterCancellationEarlyExit = (
  completionSink: EsTreeNode,
  cancellationFlagKey: string,
  context: RuleContext,
): boolean => {
  let currentNode = completionSink;
  let parentNode = currentNode.parent;
  while (parentNode) {
    if (isFunctionLike(parentNode)) return false;
    if (isNodeOfType(parentNode, "BlockStatement")) {
      const statementIndex = parentNode.body.findIndex((statement) => statement === currentNode);
      if (statementIndex >= 0) {
        for (const statement of parentNode.body.slice(0, statementIndex)) {
          if (!isNodeOfType(statement, "IfStatement")) continue;
          const cancellationResult = readCancellationCondition(
            statement.test,
            cancellationFlagKey,
            context,
          );
          if (
            (cancellationResult === true && statementAlwaysExits(statement.consequent)) ||
            (cancellationResult === false &&
              statement.alternate &&
              statementAlwaysExits(statement.alternate))
          ) {
            return true;
          }
        }
      }
    }
    currentNode = parentNode;
    parentNode = currentNode.parent;
  }
  return false;
};

const isCompletionSinkGuardedByCancellationFlag = (
  completionSink: EsTreeNode,
  cancellationFlagKey: string,
  context: RuleContext,
): boolean =>
  isCompletionSinkInsideCancellationGuard(completionSink, cancellationFlagKey, context) ||
  isCompletionSinkAfterCancellationEarlyExit(completionSink, cancellationFlagKey, context);

const isDescendantOf = (node: EsTreeNode, ancestor: EsTreeNode): boolean => {
  let currentNode: EsTreeNode | null | undefined = node;
  while (currentNode) {
    if (currentNode === ancestor) return true;
    currentNode = currentNode.parent ?? null;
  }
  return false;
};

const isPromiseContinuationForRequest = (
  functionNode: EsTreeNode,
  request: EsTreeNode,
): boolean => {
  const callNode = functionNode.parent;
  if (
    !isNodeOfType(callNode, "CallExpression") ||
    !callNode.arguments?.some((callArgument) => callArgument === functionNode) ||
    !isNodeOfType(callNode.callee, "MemberExpression") ||
    callNode.callee.computed ||
    !isNodeOfType(callNode.callee.property, "Identifier") ||
    !PROMISE_CONTINUATION_METHOD_NAMES.has(callNode.callee.property.name)
  ) {
    return false;
  }
  return isDescendantOf(request, callNode.callee.object);
};

const isAwaitedInFunction = (request: EsTreeNode, functionNode: EsTreeNode): boolean => {
  let currentNode = request.parent;
  while (currentNode && currentNode !== functionNode) {
    if (isNodeOfType(currentNode, "AwaitExpression")) return true;
    currentNode = currentNode.parent ?? null;
  }
  return false;
};

const isCompletionSinkForRequest = (completionSink: EsTreeNode, request: EsTreeNode): boolean => {
  const requestFunction = findEnclosingFunction(request);
  const completionSinkFunction = findEnclosingFunction(completionSink);
  if (!requestFunction || !completionSinkFunction) return false;
  if (requestFunction === completionSinkFunction) {
    if (!isAwaitedInFunction(request, requestFunction)) return false;
    const requestStart = getRangeStart(request);
    const completionSinkStart = getRangeStart(completionSink);
    return (
      requestStart === null || completionSinkStart === null || completionSinkStart > requestStart
    );
  }
  return isPromiseContinuationForRequest(completionSinkFunction, request);
};

const requestHasGuardedCompletionSinks = (
  request: EsTreeNode,
  completionSinks: ReadonlyArray<EsTreeNode>,
  assignedCancellationFlagKeys: ReadonlySet<string>,
  context: RuleContext,
): boolean => {
  const followingCompletionSinks = completionSinks.filter((completionSink) =>
    isCompletionSinkForRequest(completionSink, request),
  );
  return (
    followingCompletionSinks.length > 0 &&
    followingCompletionSinks.every((completionSink) =>
      [...assignedCancellationFlagKeys].some((cancellationFlagKey) =>
        isCompletionSinkGuardedByCancellationFlag(completionSink, cancellationFlagKey, context),
      ),
    )
  );
};

const allRequestsHaveCorrelatedCancellation = (
  requests: ReadonlyArray<EsTreeNode>,
  completionSinks: ReadonlyArray<EsTreeNode>,
  cleanup: EsTreeNode,
  effectCallback: EsTreeNode,
  context: RuleContext,
): boolean => {
  const abortedControllerKeys = collectCleanupAbortedControllerKeys(cleanup, context);
  const cancellationFlagKeys = collectEffectCancellationFlagKeys(effectCallback, context);
  const assignedCancellationFlagKeys = collectCleanupAssignedCancellationFlagKeys(
    cleanup,
    cancellationFlagKeys,
    context,
  );
  return requests.every((request) => {
    const requestControllerKey = resolveRequestAbortControllerKey(request, context);
    if (requestControllerKey && abortedControllerKeys.has(requestControllerKey)) return true;
    return requestHasGuardedCompletionSinks(
      request,
      completionSinks,
      assignedCancellationFlagKeys,
      context,
    );
  });
};

export const noFetchInEffect = defineRule({
  id: "no-fetch-in-effect",
  title: "Data fetching inside an effect",
  severity: "warn",
  recommendation:
    "Use a data-fetching layer or Server Component so fetches do not race, double-fire, or leak from `useEffect`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (
        !isReactApiCall(node, EFFECT_HOOK_NAMES, context.scopes, {
          allowGlobalReactNamespace: true,
          allowUnboundBareCalls: true,
          resolveNamedAliases: true,
        })
      ) {
        return;
      }
      const callback = getEffectCallback(node);
      if (!callback) return;

      const analysisFunctions = collectEffectAnalysisFunctions(callback, context);
      const requests = collectNodesFromAnalysisFunctions(analysisFunctions, isNetworkRequest);
      if (requests.length === 0) return;

      const cleanup = findEffectCleanupFunction(callback);
      if (cleanup) {
        const completionSinks = collectNodesFromAnalysisFunctions(analysisFunctions, isSetterCall);
        if (
          allRequestsHaveCorrelatedCancellation(
            requests,
            completionSinks,
            cleanup,
            callback,
            context,
          )
        ) {
          return;
        }
      }

      context.report({
        node,
        message:
          "fetch() inside useEffect can race, double-fire, or leak. Use a data-fetching layer or Server Component instead.",
      });
    },
  }),
});
