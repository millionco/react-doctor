import { getUninterruptedConstInitializer } from "../../utils/get-uninterrupted-const-initializer.js";
import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { areNodesOnExclusiveConditionalBranches } from "../../utils/are-nodes-on-exclusive-conditional-branches.js";
import { areNodesOnContradictoryGuardBranches } from "../../utils/are-nodes-on-contradictory-guard-branches.js";
import { canNodeReachLaterNodeWithinFunction } from "../../utils/can-node-reach-later-node-within-function.js";
import { getPromiseChainCallForCallback } from "../../utils/collect-effect-invoked-functions.js";
import { collectFunctionReturnStatements } from "../../utils/collect-function-return-statements.js";
import { resolveCleanupFunctions } from "../../utils/collect-returned-cleanup-functions.js";
import { defineRule } from "../../utils/define-rule.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { doNodesCoverEveryPathAfterNode } from "../../utils/do-nodes-cover-every-path-after-node.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { getDeferredEffectCallbackCall } from "../../utils/get-deferred-effect-callback-call.js";
import { getReactUseCallbackCall } from "../../utils/get-react-use-callback-call.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { resolveStaticLocalCallFunction } from "../../utils/get-order-independent-local-function.js";
import { canNodeExecuteBefore } from "../../utils/has-static-property-write-before.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isReactHookResultReference } from "../../utils/is-react-hook-result-reference.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { serializeReferenceKey } from "../../utils/serialize-reference-key.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveStateWriteSite } from "./utils/collect-effect-state-write-facts.js";
import { isClosedBooleanTimerWaiter } from "./utils/is-closed-boolean-timer-waiter.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";

const MESSAGE =
  "This setter runs after `await`, so overlapping re-runs of the effect can resolve out of order and write stale state; gate it behind a cancellation/ignore flag or return a cleanup that cancels the work.";
const DEFERRED_MESSAGE =
  "This deferred setter can run after its effect has been cleaned up and write stale state; gate it behind a cancellation/ignore flag checked inside the callback.";

const STATE_DISPATCHER_HOOKS = new Set(["useState", "useReducer"]);
const REF_HOOKS = new Set(["useRef"]);

const getDependencyArray = (
  effectCall: EsTreeNodeOfType<"CallExpression">,
): EsTreeNodeOfType<"ArrayExpression"> | null => {
  const dependencyArgument = effectCall.arguments?.[1];
  if (!dependencyArgument || !isNodeOfType(dependencyArgument, "ArrayExpression")) return null;
  return dependencyArgument;
};

const doesBindingPatternBindName = (pattern: unknown, bindingName: string): boolean => {
  if (isNodeOfType(pattern, "Identifier")) return pattern.name === bindingName;
  if (isNodeOfType(pattern, "ObjectPattern")) {
    return (pattern.properties ?? []).some((property) => {
      if (isNodeOfType(property, "Property")) {
        return doesBindingPatternBindName(property.value, bindingName);
      }
      if (isNodeOfType(property, "RestElement")) {
        return doesBindingPatternBindName(property.argument, bindingName);
      }
      return false;
    });
  }
  if (isNodeOfType(pattern, "ArrayPattern")) {
    return (pattern.elements ?? []).some((element) =>
      doesBindingPatternBindName(element, bindingName),
    );
  }
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    return doesBindingPatternBindName(pattern.left, bindingName);
  }
  if (isNodeOfType(pattern, "RestElement")) {
    return doesBindingPatternBindName(pattern.argument, bindingName);
  }
  return false;
};
const isModuleScopeConstBinding = (scopeAnchor: EsTreeNode, bindingName: string): boolean => {
  let cursor: EsTreeNode | null | undefined = scopeAnchor;
  while (cursor) {
    if (isNodeOfType(cursor, "Program")) {
      for (const statement of cursor.body ?? []) {
        if (isNodeOfType(statement, "ImportDeclaration")) {
          const bindsImportedName = (statement.specifiers ?? []).some((specifier) =>
            doesBindingPatternBindName(specifier.local, bindingName),
          );
          if (bindsImportedName) return true;
        }
        if (isNodeOfType(statement, "VariableDeclaration") && statement.kind === "const") {
          const bindsConstName = (statement.declarations ?? []).some((declarator) =>
            doesBindingPatternBindName(declarator.id, bindingName),
          );
          if (bindsConstName) return true;
        }
      }
      return false;
    }
    if (isFunctionLike(cursor)) {
      const isShadowedByParam = (cursor.params ?? []).some((param) =>
        doesBindingPatternBindName(param, bindingName),
      );
      if (isShadowedByParam) return false;
    }
    if (isNodeOfType(cursor, "BlockStatement")) {
      for (const statement of cursor.body ?? []) {
        if (isNodeOfType(statement, "VariableDeclaration")) {
          const isShadowedLocally = (statement.declarations ?? []).some((declarator) =>
            doesBindingPatternBindName(declarator.id, bindingName),
          );
          if (isShadowedLocally) return false;
        }
        if (
          isNodeOfType(statement, "FunctionDeclaration") &&
          isNodeOfType(statement.id, "Identifier") &&
          statement.id.name === bindingName
        ) {
          return false;
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};
const hasOnlyStableIdentityDependencies = ({
  dependencyArray,
  context,
}: {
  dependencyArray: EsTreeNodeOfType<"ArrayExpression">;
  context: RuleContext;
}): boolean =>
  (dependencyArray.elements ?? []).every((dependencyElement) => {
    if (!isNodeOfType(dependencyElement, "Identifier")) return false;
    const useCallbackCall = getReactUseCallbackCall(dependencyElement, context.scopes);
    const useCallbackDependencies = useCallbackCall?.arguments?.[1];
    return (
      isReactHookResultReference(dependencyElement, STATE_DISPATCHER_HOOKS, 1, context.scopes) ||
      isReactHookResultReference(dependencyElement, REF_HOOKS, null, context.scopes) ||
      isModuleScopeConstBinding(dependencyArray, dependencyElement.name) ||
      (isNodeOfType(useCallbackDependencies, "ArrayExpression") &&
        useCallbackDependencies.elements.length === 0)
    );
  });

const isStateDispatcherReference = (node: EsTreeNode, context: RuleContext): boolean =>
  isNodeOfType(node, "Identifier") &&
  isReactHookResultReference(node, STATE_DISPATCHER_HOOKS, 1, context.scopes);

const isStateDispatcherCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  if (isStateDispatcherReference(callExpression.callee, context)) return true;
  if (
    !callExpression.arguments.some((argument) =>
      isStateDispatcherReference(stripParenExpression(argument), context),
    )
  ) {
    return false;
  }
  const analysis = getProgramAnalysis(callExpression);
  const forwardedWrite = analysis
    ? resolveStateWriteSite(analysis, context, callExpression, { acceptsReducerDispatch: true })
    : null;
  return Boolean(
    forwardedWrite?.isForwardedWrite &&
    isStateDispatcherReference(stripParenExpression(forwardedWrite.setter), context),
  );
};

const findFirstSuspensionStart = (asyncFunction: EsTreeNode): number | null => {
  let earliestSuspensionStart: number | null = null;
  walkOwnFunctionScope(asyncFunction, (node) => {
    const isSuspensionPoint =
      isNodeOfType(node, "AwaitExpression") ||
      (isNodeOfType(node, "ForOfStatement") && node.await === true);
    if (!isSuspensionPoint) return;
    const start = (node as { start?: unknown }).start;
    if (typeof start !== "number") return;
    if (earliestSuspensionStart === null || start < earliestSuspensionStart) {
      earliestSuspensionStart = start;
    }
  });
  return earliestSuspensionStart;
};
const walkWithoutNestedFunctions = (
  root: EsTreeNode,
  visitor: (node: EsTreeNode) => boolean | void,
): void => {
  walkAst(root, (child: EsTreeNode) => {
    if (child !== root && isFunctionLike(child)) return false;
    return visitor(child);
  });
};

const findContainingEffectCallback = (
  functionNode: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  let currentFunction: EsTreeNode | null = functionNode;
  while (currentFunction) {
    const parent = currentFunction.parent;
    if (
      parent &&
      isNodeOfType(parent, "CallExpression") &&
      getEffectCallback(parent) === currentFunction &&
      isReactApiCall(parent, EFFECT_HOOK_NAMES, context.scopes, {
        allowGlobalReactNamespace: true,
        allowUnboundBareCalls: true,
      })
    ) {
      return currentFunction;
    }
    currentFunction = findEnclosingFunction(currentFunction);
  }
  return null;
};

const doesMutableInitializerExecuteBeforeCall = (
  declarationNode: EsTreeNode,
  call: EsTreeNode,
  context: RuleContext,
): boolean => {
  const declarationFunction = findEnclosingFunction(declarationNode);
  const callFunction = findEnclosingFunction(call);
  if (!declarationFunction || !callFunction) return false;
  if (declarationFunction === callFunction) {
    return canNodeExecuteBefore(declarationNode, call, context.scopes);
  }
  const effectCallback = findContainingEffectCallback(callFunction, context);
  if (
    effectCallback &&
    declarationFunction !== effectCallback &&
    isAstDescendant(effectCallback, declarationFunction)
  ) {
    return isNodeReachableWithinFunction(declarationNode, context);
  }
  if (!isAstDescendant(callFunction, declarationFunction)) return false;
  return declarationNode.range[0] < callFunction.range[0];
};

const collectDirectlyInvokedFunctions = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): EsTreeNode[] => {
  const functions = new Set<EsTreeNode>();
  const callee = stripParenExpression(call.callee);
  if (isFunctionLike(callee)) {
    functions.add(callee);
  } else if (isNodeOfType(callee, "Identifier")) {
    const symbol = context.scopes.symbolFor(callee);
    const resolvedFunction = resolveStaticLocalCallFunction(call, context.scopes);
    const isMutableBinding = symbol?.kind === "let" || symbol?.kind === "var";
    const isImmutableInPractice = Boolean(
      !isMutableBinding || symbol?.references.every((reference) => reference.flag === "read"),
    );
    const didInitializerExecuteBeforeCall =
      !isMutableBinding ||
      Boolean(
        symbol?.initializer &&
        doesMutableInitializerExecuteBeforeCall(symbol.declarationNode, call, context),
      );
    if (resolvedFunction && isImmutableInPractice && didInitializerExecuteBeforeCall) {
      functions.add(resolvedFunction);
    }
  }
  for (const argument of call.arguments ?? []) {
    const callback = stripParenExpression(argument);
    if (
      isFunctionLike(callback) &&
      (getPromiseChainCallForCallback(callback) === call ||
        getDeferredEffectCallbackCall(callback, context.scopes) === call)
    ) {
      functions.add(callback);
    }
  }
  return [...functions].filter(
    (invokedFunction) => isFunctionLike(invokedFunction) && !invokedFunction.generator,
  );
};

const collectTransitivelyInvokedFunctions = (
  rootFunction: EsTreeNode,
  context: RuleContext,
): Set<EsTreeNode> => {
  const invokedFunctions = new Set([rootFunction]);
  const pendingFunctions = [rootFunction];
  while (pendingFunctions.length > 0) {
    const currentFunction = pendingFunctions.pop();
    if (!currentFunction) break;
    walkOwnFunctionScope(currentFunction, (candidate: EsTreeNode) => {
      if (!isNodeOfType(candidate, "CallExpression")) return;
      for (const invokedFunction of collectDirectlyInvokedFunctions(candidate, context)) {
        if (invokedFunctions.has(invokedFunction)) continue;
        invokedFunctions.add(invokedFunction);
        pendingFunctions.push(invokedFunction);
      }
    });
  }
  return invokedFunctions;
};

const doesFunctionTransitivelyInvokeTarget = (
  rootFunction: EsTreeNode,
  targetFunction: EsTreeNode,
  context: RuleContext,
  memoizedResults: Map<EsTreeNode, boolean>,
): boolean => {
  const memoizedResult = memoizedResults.get(rootFunction);
  if (memoizedResult !== undefined) return memoizedResult;
  const doesInvokeTarget = collectTransitivelyInvokedFunctions(rootFunction, context).has(
    targetFunction,
  );
  memoizedResults.set(rootFunction, doesInvokeTarget);
  return doesInvokeTarget;
};

const doFunctionsHaveUnguardedTargetInvocationPath = (
  rootFunctions: EsTreeNode[],
  targetFunction: EsTreeNode,
  noCleanupReturn: EsTreeNode,
  context: RuleContext,
): boolean => {
  const visitedFunctions = new Set<EsTreeNode>();
  const pendingFunctions = [...rootFunctions];
  while (pendingFunctions.length > 0) {
    const currentFunction = pendingFunctions.pop();
    if (!currentFunction) break;
    if (currentFunction === targetFunction) return true;
    if (visitedFunctions.has(currentFunction)) continue;
    visitedFunctions.add(currentFunction);
    walkOwnFunctionScope(currentFunction, (candidate: EsTreeNode) => {
      if (
        !isNodeOfType(candidate, "CallExpression") ||
        areNodesOnContradictoryGuardBranches(candidate, noCleanupReturn, context.scopes)
      ) {
        return;
      }
      pendingFunctions.push(...collectDirectlyInvokedFunctions(candidate, context));
    });
  }
  return false;
};

interface EffectInvocationAnchor {
  anchor: EsTreeNode;
  targetReachableFunctions: EsTreeNode[];
}

const collectEffectInvocationAnchors = (
  effectCallback: EsTreeNode,
  invokedFunction: EsTreeNode,
  context: RuleContext,
): EffectInvocationAnchor[] => {
  const invocationAnchors: EffectInvocationAnchor[] = [];
  const targetReachability = new Map<EsTreeNode, boolean>();
  walkOwnFunctionScope(effectCallback, (candidate: EsTreeNode) => {
    if (!isNodeOfType(candidate, "CallExpression")) return;
    const targetReachableFunctions = collectDirectlyInvokedFunctions(candidate, context).filter(
      (directlyInvokedFunction) =>
        doesFunctionTransitivelyInvokeTarget(
          directlyInvokedFunction,
          invokedFunction,
          context,
          targetReachability,
        ),
    );
    if (targetReachableFunctions.length === 0) return;
    invocationAnchors.push({ anchor: candidate, targetReachableFunctions });
  });
  return invocationAnchors;
};

const collectCleanupFunctionsAfterInvocations = (
  effectCallback: EsTreeNode,
  invokedFunction: EsTreeNode,
  context: RuleContext,
): EsTreeNode[] => {
  if (!isFunctionLike(effectCallback)) return [];
  if (!isNodeOfType(effectCallback.body, "BlockStatement")) {
    return resolveCleanupFunctions(effectCallback.body, effectCallback, context.scopes);
  }
  const returnStatements = collectFunctionReturnStatements(effectCallback);
  const cleanupReturns = returnStatements.flatMap((returnStatement) => {
    if (!returnStatement.argument) return [];
    const cleanupFunctions = resolveCleanupFunctions(
      returnStatement.argument as EsTreeNode,
      returnStatement,
      context.scopes,
    );
    return cleanupFunctions.length > 0 ? [{ cleanupFunctions, returnStatement }] : [];
  });
  const invocationAnchors = collectEffectInvocationAnchors(
    effectCallback,
    invokedFunction,
    context,
  );
  const reachableCleanupReturns = new Set<(typeof cleanupReturns)[number]>();
  for (const { anchor, targetReachableFunctions } of invocationAnchors) {
    const returnsAfterInvocation = returnStatements.filter((returnStatement) =>
      canNodeReachLaterNodeWithinFunction(anchor, returnStatement, effectCallback, context),
    );
    if (!doNodesCoverEveryPathAfterNode(anchor, returnsAfterInvocation, context)) return [];
    const cleanupReturnsAfterInvocation = cleanupReturns.filter(({ returnStatement }) =>
      returnsAfterInvocation.includes(returnStatement),
    );
    const cleanupReturnStatements = new Set(
      cleanupReturnsAfterInvocation.map(({ returnStatement }) => returnStatement),
    );
    const returnsWithoutCleanup = returnsAfterInvocation.filter(
      (returnStatement) => !cleanupReturnStatements.has(returnStatement),
    );
    const areNoCleanupReturnsExclusiveWithInvocations = returnsWithoutCleanup.every(
      (returnStatement) => {
        if (areNodesOnContradictoryGuardBranches(anchor, returnStatement, context.scopes)) {
          return true;
        }
        return !doFunctionsHaveUnguardedTargetInvocationPath(
          targetReachableFunctions,
          invokedFunction,
          returnStatement,
          context,
        );
      },
    );
    if (!areNoCleanupReturnsExclusiveWithInvocations) {
      return [];
    }
    for (const cleanupReturn of cleanupReturnsAfterInvocation) {
      reachableCleanupReturns.add(cleanupReturn);
    }
  }
  return [...reachableCleanupReturns].flatMap(({ cleanupFunctions }) => cleanupFunctions);
};

const collectUnconditionalCleanupActions = (
  statements: EsTreeNode[],
  recordAction: (candidate: EsTreeNode) => void,
): boolean => {
  for (const statement of statements) {
    if (isNodeOfType(statement, "ExpressionStatement")) {
      recordAction(statement);
      continue;
    }
    if (isNodeOfType(statement, "BlockStatement")) {
      if (!collectUnconditionalCleanupActions(statement.body as EsTreeNode[], recordAction)) {
        return false;
      }
      continue;
    }
    if (isNodeOfType(statement, "TryStatement")) {
      if (statement.finalizer) {
        collectUnconditionalCleanupActions(statement.finalizer.body as EsTreeNode[], recordAction);
      }
      let hasAbruptExit = false;
      walkAst(statement, (candidate: EsTreeNode) => {
        if (candidate !== statement && isFunctionLike(candidate)) return false;
        if (
          isNodeOfType(candidate, "ReturnStatement") ||
          isNodeOfType(candidate, "ThrowStatement")
        ) {
          hasAbruptExit = true;
        }
        return undefined;
      });
      if (hasAbruptExit) return false;
      continue;
    }
    return false;
  }
  return true;
};

const collectCleanupGuardWrites = (
  cleanupFunctions: EsTreeNode[],
  context: RuleContext,
): Map<string, boolean> => {
  const cleanupWriteMaps = cleanupFunctions.map((cleanupFunction) => {
    const writes = new Map<string, boolean>();
    if (!isFunctionLike(cleanupFunction)) return writes;
    const recordAssignment = (candidate: EsTreeNode): void => {
      const expression = isNodeOfType(candidate, "ExpressionStatement")
        ? (candidate.expression as EsTreeNode)
        : candidate;
      const assignedValue = isNodeOfType(expression, "AssignmentExpression")
        ? stripParenExpression(expression.right)
        : null;
      if (
        !isNodeOfType(expression, "AssignmentExpression") ||
        expression.operator !== "=" ||
        !isNodeOfType(assignedValue, "Literal") ||
        typeof assignedValue.value !== "boolean"
      ) {
        return;
      }
      const targetKey = serializeReferenceKey({
        node: expression.left,
        scopes: context.scopes,
      });
      if (targetKey) writes.set(targetKey, assignedValue.value);
    };
    const body = cleanupFunction.body;
    if (isNodeOfType(body, "BlockStatement")) {
      collectUnconditionalCleanupActions(body.body as EsTreeNode[], recordAssignment);
    } else if (body) {
      recordAssignment(body);
    }
    return writes;
  });
  const [firstWrites, ...remainingWrites] = cleanupWriteMaps;
  const writes = new Map<string, boolean>();
  if (!firstWrites) return writes;
  for (const [targetKey, value] of firstWrites) {
    if (remainingWrites.every((candidateWrites) => candidateWrites.get(targetKey) === value)) {
      writes.set(targetKey, value);
    }
  }
  return writes;
};

const collectCleanupAbortedControllers = (
  cleanupFunctions: EsTreeNode[],
  context: RuleContext,
): Set<string> => {
  const cleanupControllerSets = cleanupFunctions.map((cleanupFunction) => {
    const controllerKeys = new Set<string>();
    if (!isFunctionLike(cleanupFunction)) return controllerKeys;
    const recordAbort = (candidate: EsTreeNode): void => {
      const expression = isNodeOfType(candidate, "ExpressionStatement")
        ? candidate.expression
        : candidate;
      if (!isNodeOfType(expression, "CallExpression")) return;
      const callee = stripParenExpression(expression.callee);
      if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== "abort") {
        return;
      }
      const receiver = stripParenExpression(callee.object);
      const receiverKey = serializeReferenceKey({ node: receiver, scopes: context.scopes });
      if (receiverKey) controllerKeys.add(receiverKey);
    };
    const body = cleanupFunction.body;
    if (isNodeOfType(body, "BlockStatement")) {
      collectUnconditionalCleanupActions(body.body as EsTreeNode[], recordAbort);
    } else if (body) {
      recordAbort(body);
    }
    return controllerKeys;
  });
  const [firstControllerKeys, ...remainingControllerSets] = cleanupControllerSets;
  const controllerKeys = new Set<string>();
  if (!firstControllerKeys) return controllerKeys;
  for (const controllerKey of firstControllerKeys) {
    if (remainingControllerSets.every((candidateKeys) => candidateKeys.has(controllerKey))) {
      controllerKeys.add(controllerKey);
    }
  }
  return controllerKeys;
};

const collectAbortControllerKeys = (
  effectCallback: EsTreeNode,
  context: RuleContext,
): Set<string> => {
  const controllerKeys = new Set<string>();
  walkOwnFunctionScope(effectCallback, (child: EsTreeNode) => {
    if (
      !isNodeOfType(child, "VariableDeclarator") ||
      !isNodeOfType(child.id, "Identifier") ||
      !child.init ||
      !isNodeOfType(stripParenExpression(child.init), "NewExpression")
    ) {
      return;
    }
    const construction = stripParenExpression(child.init) as EsTreeNodeOfType<"NewExpression">;
    if (
      isNodeOfType(construction.callee, "Identifier") &&
      construction.callee.name === "AbortController" &&
      context.scopes.isGlobalReference(construction.callee)
    ) {
      const controllerKey = serializeReferenceKey({ node: child.id, scopes: context.scopes });
      if (controllerKey) controllerKeys.add(controllerKey);
    }
  });
  return controllerKeys;
};

const awaitUsesAbortedControllerSignal = (
  awaitNode: EsTreeNodeOfType<"AwaitExpression">,
  controllerKeys: ReadonlySet<string>,
  context: RuleContext,
): boolean => {
  let usesSignal = false;
  walkWithoutNestedFunctions(awaitNode.argument, (child: EsTreeNode) => {
    const receiver = isNodeOfType(child, "MemberExpression")
      ? stripParenExpression(child.object)
      : null;
    const receiverKey = receiver
      ? serializeReferenceKey({ node: receiver, scopes: context.scopes })
      : null;
    if (
      isNodeOfType(child, "MemberExpression") &&
      getStaticPropertyName(child) === "signal" &&
      receiverKey !== null &&
      controllerKeys.has(receiverKey)
    ) {
      usesSignal = true;
      return false;
    }
  });
  return usesSignal;
};

const getLocalPredicateExpression = (
  expression: EsTreeNode,
  context: RuleContext,
): { predicate: EsTreeNode; returnedExpression: EsTreeNode } | null => {
  const candidate = stripParenExpression(expression);
  if (
    !isNodeOfType(candidate, "CallExpression") ||
    candidate.arguments.length !== 0 ||
    !isNodeOfType(candidate.callee, "Identifier")
  ) {
    return null;
  }
  const predicate = resolveExactLocalFunction(candidate.callee, context.scopes);
  if (
    !predicate ||
    !isFunctionLike(predicate) ||
    predicate.async ||
    predicate.generator ||
    predicate.params.length !== 0
  ) {
    return null;
  }
  const returnedExpression = isNodeOfType(predicate.body, "BlockStatement")
    ? predicate.body.body.length === 1 &&
      isNodeOfType(predicate.body.body[0], "ReturnStatement") &&
      predicate.body.body[0].argument
      ? predicate.body.body[0].argument
      : null
    : predicate.body;
  return returnedExpression ? { predicate, returnedExpression } : null;
};

const isSideEffectFreeGuardExpression = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedPredicates = new Set<EsTreeNode>(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier") || isNodeOfType(candidate, "Literal")) {
    return true;
  }
  if (isNodeOfType(candidate, "MemberExpression")) {
    return (
      getStaticPropertyName(candidate) === "current" &&
      isNodeOfType(stripParenExpression(candidate.object), "Identifier") &&
      isReactHookResultReference(
        stripParenExpression(candidate.object),
        REF_HOOKS,
        null,
        context.scopes,
      )
    );
  }
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "!") {
    return isSideEffectFreeGuardExpression(candidate.argument, context, visitedPredicates);
  }
  if (
    isNodeOfType(candidate, "BinaryExpression") &&
    ["==", "===", "!=", "!=="].includes(candidate.operator)
  ) {
    return (
      isSideEffectFreeGuardExpression(candidate.left, context, visitedPredicates) &&
      isSideEffectFreeGuardExpression(candidate.right, context, visitedPredicates)
    );
  }
  if (isNodeOfType(candidate, "LogicalExpression")) {
    return (
      isSideEffectFreeGuardExpression(candidate.left, context, visitedPredicates) &&
      isSideEffectFreeGuardExpression(candidate.right, context, visitedPredicates)
    );
  }
  const localPredicate = getLocalPredicateExpression(candidate, context);
  if (!localPredicate || visitedPredicates.has(localPredicate.predicate)) return false;
  visitedPredicates.add(localPredicate.predicate);
  const isSideEffectFree = isSideEffectFreeGuardExpression(
    localPredicate.returnedExpression,
    context,
    visitedPredicates,
  );
  visitedPredicates.delete(localPredicate.predicate);
  return isSideEffectFree;
};

const doesBooleanExpressionForceValue = (
  expression: EsTreeNode,
  expectedValue: boolean,
  resolveAtomicValue: (candidate: EsTreeNode, expectedAtomicValue: boolean) => boolean,
  context: RuleContext,
  visitedPredicates = new Set<EsTreeNode>(),
): boolean => {
  const candidate = stripParenExpression(expression);
  const aliasInitializer = getUninterruptedConstInitializer(candidate, context);
  const booleanArgument =
    isNodeOfType(candidate, "CallExpression") &&
    isNodeOfType(candidate.callee, "Identifier") &&
    candidate.callee.name === "Boolean" &&
    context.scopes.isGlobalReference(candidate.callee) &&
    candidate.arguments.length === 1
      ? candidate.arguments[0]
      : null;
  const transparentExpression = aliasInitializer ?? booleanArgument;
  if (transparentExpression && !visitedPredicates.has(transparentExpression)) {
    visitedPredicates.add(transparentExpression);
    const doesValueForceGuard = doesBooleanExpressionForceValue(
      transparentExpression,
      expectedValue,
      resolveAtomicValue,
      context,
      visitedPredicates,
    );
    visitedPredicates.delete(transparentExpression);
    return doesValueForceGuard;
  }
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "!") {
    return doesBooleanExpressionForceValue(
      candidate.argument,
      !expectedValue,
      resolveAtomicValue,
      context,
      visitedPredicates,
    );
  }
  if (isNodeOfType(candidate, "LogicalExpression")) {
    if (!isSideEffectFreeGuardExpression(candidate, context)) return false;
    const leftForcesValue = doesBooleanExpressionForceValue(
      candidate.left,
      expectedValue,
      resolveAtomicValue,
      context,
      visitedPredicates,
    );
    const rightForcesValue = doesBooleanExpressionForceValue(
      candidate.right,
      expectedValue,
      resolveAtomicValue,
      context,
      visitedPredicates,
    );
    if (candidate.operator === "&&") {
      return expectedValue
        ? leftForcesValue && rightForcesValue
        : leftForcesValue || rightForcesValue;
    }
    if (candidate.operator === "||") {
      return expectedValue
        ? leftForcesValue || rightForcesValue
        : leftForcesValue && rightForcesValue;
    }
  }
  const localPredicate = getLocalPredicateExpression(candidate, context);
  if (localPredicate && !visitedPredicates.has(localPredicate.predicate)) {
    visitedPredicates.add(localPredicate.predicate);
    const doesPredicateForceValue = doesBooleanExpressionForceValue(
      localPredicate.returnedExpression,
      expectedValue,
      resolveAtomicValue,
      context,
      visitedPredicates,
    );
    visitedPredicates.delete(localPredicate.predicate);
    return doesPredicateForceValue;
  }
  return resolveAtomicValue(candidate, expectedValue);
};

const doesCleanupForceGuardValue = (
  test: EsTreeNode,
  expectedValue: boolean,
  cleanupWrites: ReadonlyMap<string, boolean>,
  context: RuleContext,
): boolean =>
  doesBooleanExpressionForceValue(
    test,
    expectedValue,
    (candidate, expectedAtomicValue) => {
      const targetKey = serializeReferenceKey({ node: candidate, scopes: context.scopes });
      const cleanupValue = targetKey ? cleanupWrites.get(targetKey) : undefined;
      return cleanupValue === expectedAtomicValue;
    },
    context,
  );

interface SequenceSnapshot {
  counterKey: string;
}

interface PostSuspensionWrites {
  objectKeys: Set<string>;
  referenceKeys: Set<string>;
}

const serializeCanonicalReferenceKey = (node: EsTreeNode, context: RuleContext): string | null => {
  const candidate = stripParenExpression(node);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = resolveConstIdentifierAlias(candidate, context.scopes);
    return symbol
      ? serializeReferenceKey({ node: symbol.bindingIdentifier, scopes: context.scopes })
      : serializeReferenceKey({ node: candidate, scopes: context.scopes });
  }
  if (!isNodeOfType(candidate, "MemberExpression")) return null;
  const receiverKey = serializeCanonicalReferenceKey(candidate.object, context);
  const propertyName = getStaticPropertyName(candidate);
  return receiverKey && propertyName ? `${receiverKey}.${propertyName}` : null;
};

const collectSequenceSnapshots = (
  root: EsTreeNode,
  firstSuspensionStart: number,
  context: RuleContext,
): Map<string, SequenceSnapshot> => {
  const snapshots = new Map<string, SequenceSnapshot>();
  walkWithoutNestedFunctions(root, (child: EsTreeNode) => {
    const initializer =
      isNodeOfType(child, "VariableDeclarator") && child.init
        ? stripParenExpression(child.init)
        : null;
    if (
      !isNodeOfType(child, "VariableDeclarator") ||
      !isNodeOfType(child.id, "Identifier") ||
      !isNodeOfType(initializer, "UpdateExpression") ||
      initializer.operator !== "++"
    ) {
      return;
    }
    const counterKey = serializeReferenceKey({
      node: initializer.argument,
      scopes: context.scopes,
    });
    const start = (child as { start?: unknown }).start;
    if (counterKey && typeof start === "number" && start < firstSuspensionStart) {
      const snapshotKey = serializeReferenceKey({ node: child.id, scopes: context.scopes });
      if (snapshotKey) snapshots.set(snapshotKey, { counterKey });
    }
  });
  return snapshots;
};

const collectPostSuspensionWrittenReferenceKeys = (
  asyncFunction: EsTreeNode,
  firstSuspensionStart: number,
  context: RuleContext,
): PostSuspensionWrites => {
  const mutatedObjectKeys = new Set<string>();
  const writtenReferenceKeys = new Set<string>();
  const visitedFunctions = new Set<EsTreeNode>();
  const collectWriteTarget = (target: EsTreeNode): void => {
    const candidate = stripParenExpression(target);
    if (isNodeOfType(candidate, "ArrayPattern")) {
      for (const element of candidate.elements) {
        if (element) collectWriteTarget(element);
      }
      return;
    }
    if (isNodeOfType(candidate, "ObjectPattern")) {
      for (const property of candidate.properties) {
        if (isNodeOfType(property, "Property")) {
          collectWriteTarget(property.value);
        } else if (isNodeOfType(property, "RestElement")) {
          collectWriteTarget(property.argument);
        }
      }
      return;
    }
    if (isNodeOfType(candidate, "AssignmentPattern")) {
      collectWriteTarget(candidate.left);
      return;
    }
    if (isNodeOfType(candidate, "RestElement")) {
      collectWriteTarget(candidate.argument);
      return;
    }
    const targetKey = serializeReferenceKey({ node: candidate, scopes: context.scopes });
    if (targetKey) writtenReferenceKeys.add(targetKey);
    const canonicalTargetKey = serializeCanonicalReferenceKey(candidate, context);
    if (canonicalTargetKey) writtenReferenceKeys.add(canonicalTargetKey);
  };
  const collectWrites = (root: EsTreeNode, minimumStart: number | null): void => {
    walkOwnFunctionScope(root, (child: EsTreeNode) => {
      const start = (child as { start?: unknown }).start;
      if (minimumStart !== null && (typeof start !== "number" || start <= minimumStart)) return;
      const writeTarget = isNodeOfType(child, "AssignmentExpression")
        ? child.left
        : isNodeOfType(child, "UpdateExpression")
          ? child.argument
          : isNodeOfType(child, "UnaryExpression") && child.operator === "delete"
            ? child.argument
            : (isNodeOfType(child, "ForInStatement") || isNodeOfType(child, "ForOfStatement")) &&
                !isNodeOfType(child.left, "VariableDeclaration")
              ? child.left
              : null;
      if (writeTarget) collectWriteTarget(writeTarget);
      if (!isNodeOfType(child, "CallExpression")) return;
      const callee = stripParenExpression(child.callee);
      if (isNodeOfType(callee, "MemberExpression")) {
        const receiver = stripParenExpression(callee.object);
        const methodName = getStaticPropertyName(callee);
        const isObjectMutation =
          isNodeOfType(receiver, "Identifier") &&
          receiver.name === "Object" &&
          context.scopes.isGlobalReference(receiver) &&
          (methodName === "assign" ||
            methodName === "defineProperties" ||
            methodName === "defineProperty");
        const isReflectMutation =
          isNodeOfType(receiver, "Identifier") &&
          receiver.name === "Reflect" &&
          context.scopes.isGlobalReference(receiver) &&
          (methodName === "defineProperty" ||
            methodName === "deleteProperty" ||
            methodName === "set");
        const mutationTarget = isObjectMutation || isReflectMutation ? child.arguments[0] : null;
        if (mutationTarget && !isNodeOfType(mutationTarget, "SpreadElement")) {
          const targetKey = serializeReferenceKey({
            node: mutationTarget,
            scopes: context.scopes,
          });
          if (targetKey) mutatedObjectKeys.add(targetKey);
          const canonicalTargetKey = serializeCanonicalReferenceKey(mutationTarget, context);
          if (canonicalTargetKey) mutatedObjectKeys.add(canonicalTargetKey);
        }
      }
      const invokedFunctions = [
        resolveExactLocalFunction(child.callee, context.scopes),
        ...child.arguments.map((argument) =>
          isNodeOfType(argument, "SpreadElement")
            ? null
            : resolveExactLocalFunction(argument, context.scopes),
        ),
      ];
      for (const invokedFunction of invokedFunctions) {
        if (
          !invokedFunction ||
          !isFunctionLike(invokedFunction) ||
          invokedFunction.generator ||
          visitedFunctions.has(invokedFunction)
        ) {
          continue;
        }
        visitedFunctions.add(invokedFunction);
        collectWrites(invokedFunction, null);
      }
    });
  };
  visitedFunctions.add(asyncFunction);
  collectWrites(asyncFunction, firstSuspensionStart);
  return { objectKeys: mutatedObjectKeys, referenceKeys: writtenReferenceKeys };
};

const doesPostSuspensionWriteReference = (
  referenceKey: string,
  postSuspensionWrites: PostSuspensionWrites,
): boolean => {
  if (postSuspensionWrites.referenceKeys.has(referenceKey)) return true;
  for (const objectKey of postSuspensionWrites.objectKeys) {
    if (referenceKey === objectKey || referenceKey.startsWith(`${objectKey}.`)) return true;
  }
  return false;
};

const isSequenceComparison = (
  test: EsTreeNode,
  expectedValue: boolean,
  sequenceSnapshots: ReadonlyMap<string, SequenceSnapshot>,
  context: RuleContext,
): boolean => {
  const inner = stripParenExpression(test);
  if (
    !isNodeOfType(inner, "BinaryExpression") ||
    !["==", "===", "!=", "!=="].includes(inner.operator)
  ) {
    return false;
  }
  const comparisonValue = inner.operator === "!=" || inner.operator === "!==";
  if (comparisonValue !== expectedValue) return false;
  const left = stripParenExpression(inner.left);
  const right = stripParenExpression(inner.right);
  if (isNodeOfType(left, "Identifier")) {
    const leftKey = serializeReferenceKey({ node: left, scopes: context.scopes });
    const snapshot = leftKey ? sequenceSnapshots.get(leftKey) : undefined;
    if (snapshot?.counterKey === serializeReferenceKey({ node: right, scopes: context.scopes })) {
      return true;
    }
  }
  if (isNodeOfType(right, "Identifier")) {
    const rightKey = serializeReferenceKey({ node: right, scopes: context.scopes });
    const snapshot = rightKey ? sequenceSnapshots.get(rightKey) : undefined;
    if (snapshot?.counterKey === serializeReferenceKey({ node: left, scopes: context.scopes })) {
      return true;
    }
  }
  return false;
};

const doesSequenceMismatchForceGuardValue = (
  test: EsTreeNode,
  expectedValue: boolean,
  sequenceSnapshots: ReadonlyMap<string, SequenceSnapshot>,
  context: RuleContext,
): boolean =>
  doesBooleanExpressionForceValue(
    test,
    expectedValue,
    (candidate, expectedAtomicValue) =>
      isSequenceComparison(candidate, expectedAtomicValue, sequenceSnapshots, context),
    context,
  );

interface WhileTransferStates {
  readonly continues: AsyncPathState[];
  readonly breaks: AsyncPathState[];
}

interface OwnedCancellationUses {
  readonly signalReads: ReadonlySet<EsTreeNode>;
  readonly guardedWaitCalls: ReadonlySet<EsTreeNode>;
}

interface AsyncCancellationAnalysis extends OwnedCancellationUses {
  readonly cleanupWrites: ReadonlyMap<string, boolean>;
  readonly transfers?: WhileTransferStates;
}

interface AsyncStatementAnalysis {
  states: AsyncPathState[];
  hasUnsafeSetter: boolean;
}

interface AsyncPathState {
  didSuspend: boolean;
  hasDominatingGuard: boolean;
  hasFreshCancellationGuard?: boolean;
  isAbortProtected: boolean;
  suspensionNode: EsTreeNode | null;
}

const dedupeAsyncPathStates = (states: AsyncPathState[]): AsyncPathState[] => {
  const dedupedStates = new Map<string, AsyncPathState>();
  for (const state of states) {
    const suspensionStart = state.suspensionNode?.range?.[0] ?? "none";
    const key = `${String(state.didSuspend)}:${String(state.hasDominatingGuard)}:${String(Boolean(state.hasFreshCancellationGuard))}:${String(state.isAbortProtected)}:${String(suspensionStart)}`;
    if (!dedupedStates.has(key)) dedupedStates.set(key, state);
  }
  return [...dedupedStates.values()];
};

const collectSwitchPathStatements = (
  cases: EsTreeNodeOfType<"SwitchCase">[],
  entryIndex: number,
): EsTreeNode[] => {
  const statements: EsTreeNode[] = [];
  for (let caseIndex = entryIndex; caseIndex < cases.length; caseIndex += 1) {
    for (const consequent of cases[caseIndex]?.consequent ?? []) {
      if (isNodeOfType(consequent, "BreakStatement")) return statements;
      statements.push(consequent);
    }
  }
  return statements;
};

const isLiteralAsyncPrimitive = (rawExpression: EsTreeNode): boolean => {
  const expression = stripParenExpression(rawExpression);
  return (
    isNodeOfType(expression, "Literal") &&
    (expression.value === null || typeof expression.value !== "object") &&
    !("regex" in expression)
  );
};

const isPotentiallyReentrantAsyncEvent = (
  node: EsTreeNode,
  cancellation: AsyncCancellationAnalysis,
  context: RuleContext,
): boolean => {
  const parent = node.parent;
  if (
    ((isNodeOfType(parent, "ForOfStatement") || isNodeOfType(parent, "ForInStatement")) &&
      parent.right === node) ||
    (isNodeOfType(parent, "AssignmentPattern") && parent.left === node)
  ) {
    return true;
  }
  if (
    (isNodeOfType(parent, "Property") ||
      isNodeOfType(parent, "MethodDefinition") ||
      isNodeOfType(parent, "PropertyDefinition")) &&
    parent.computed &&
    parent.key === node &&
    !isLiteralAsyncPrimitive(node)
  ) {
    return true;
  }
  if (isNodeOfType(node, "MemberExpression")) {
    return !isNonReentrantCancellationTest(node, cancellation, context);
  }
  if (isNodeOfType(node, "VariableDeclarator")) {
    return isNodeOfType(node.id, "ArrayPattern") || isNodeOfType(node.id, "ObjectPattern");
  }
  if (isNodeOfType(node, "TemplateLiteral")) {
    return (
      !isNodeOfType(node.parent, "TaggedTemplateExpression") &&
      node.expressions.some((expression) => !isLiteralAsyncPrimitive(expression))
    );
  }
  if (isNodeOfType(node, "UnaryExpression")) {
    return (
      (node.operator === "+" || node.operator === "-" || node.operator === "~") &&
      !isLiteralAsyncPrimitive(node.argument)
    );
  }
  if (isNodeOfType(node, "BinaryExpression")) {
    return (
      node.operator === "in" ||
      node.operator === "instanceof" ||
      (node.operator !== "===" &&
        node.operator !== "!==" &&
        (!isLiteralAsyncPrimitive(node.left) || !isLiteralAsyncPrimitive(node.right)))
    );
  }
  return (
    isNodeOfType(node, "NewExpression") ||
    isNodeOfType(node, "TaggedTemplateExpression") ||
    isNodeOfType(node, "SpreadElement") ||
    isNodeOfType(node, "UpdateExpression") ||
    (isNodeOfType(node, "AssignmentExpression") &&
      (node.operator !== "=" ||
        isNodeOfType(node.left, "ArrayPattern") ||
        isNodeOfType(node.left, "ObjectPattern")))
  );
};

const collectOrderedAsyncEvents = (
  root: EsTreeNode,
  context: RuleContext,
  cancellation?: AsyncCancellationAnalysis,
): EsTreeNode[] => {
  const events: EsTreeNode[] = [];
  walkWithoutNestedFunctions(root, (child: EsTreeNode) => {
    if (
      (isNodeOfType(child, "AwaitExpression") ||
        (isNodeOfType(child, "ForOfStatement") && child.await === true) ||
        (isNodeOfType(child, "CallExpression") &&
          (cancellation || isStateDispatcherCall(child, context))) ||
        (cancellation && isPotentiallyReentrantAsyncEvent(child, cancellation, context))) &&
      isNodeReachableWithinFunction(child, context)
    ) {
      events.push(child);
    }
  });
  return events.sort(
    (left, right) => ((left as { end?: number }).end ?? 0) - ((right as { end?: number }).end ?? 0),
  );
};

const isGuardedLoopSetter = (
  setter: EsTreeNodeOfType<"CallExpression">,
  cleanupWrites: ReadonlyMap<string, boolean>,
  context: RuleContext,
): boolean => {
  if (setter.optional || !isStateDispatcherReference(setter.callee, context)) return false;
  const [argument] = setter.arguments;
  if (
    setter.arguments.length !== 1 ||
    (!isNodeOfType(argument, "Identifier") && !isNodeOfType(argument, "Literal"))
  ) {
    return false;
  }
  const setterBinding = context.scopes.symbolFor(setter.callee);
  if (
    setterBinding?.kind !== "const" ||
    setterBinding.references.length !== 1 ||
    !hasCompleteSymbolReferences(setterBinding, context.scopes.rootScope.node, context.scopes)
  ) {
    return false;
  }
  const statement = setter.parent;
  const body = statement?.parent;
  const loop = body?.parent;
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    statement.expression !== setter ||
    !isNodeOfType(body, "BlockStatement") ||
    body.body.length !== 3 ||
    !isNodeOfType(loop, "ForOfStatement") ||
    loop.await ||
    loop.body !== body
  ) {
    return false;
  }
  const [precedingAwait, guard, guardedStatement] = body.body;
  if (guardedStatement !== statement) return false;
  if (
    !isNodeOfType(precedingAwait, "ExpressionStatement") ||
    !isNodeOfType(precedingAwait.expression, "AwaitExpression") ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(guard.test, "Identifier")
  ) {
    return false;
  }
  const awaited = precedingAwait.expression.argument;
  const loopDeclarations = loop.left;
  if (
    !isNodeOfType(loopDeclarations, "VariableDeclaration") ||
    loopDeclarations.kind !== "const" ||
    loopDeclarations.declarations.length !== 1 ||
    !isNodeOfType(loopDeclarations.declarations[0]?.id, "Identifier") ||
    (!isNodeOfType(loop.right, "Identifier") &&
      (!isNodeOfType(loop.right, "ArrayExpression") ||
        !loop.right.elements.every(
          (item) => isNodeOfType(item, "Identifier") || isNodeOfType(item, "Literal"),
        ))) ||
    !isNodeOfType(awaited, "CallExpression") ||
    awaited.optional ||
    !isNodeOfType(awaited.callee, "MemberExpression") ||
    awaited.callee.optional ||
    getStaticPropertyName(awaited.callee) !== "resolve" ||
    awaited.arguments.length !== 1 ||
    !isNodeOfType(awaited.arguments[0], "Identifier")
  ) {
    return false;
  }
  const iterationValue = context.scopes.symbolFor(loopDeclarations.declarations[0].id);
  if (
    !iterationValue ||
    context.scopes.symbolFor(awaited.arguments[0]) !== iterationValue ||
    (isNodeOfType(argument, "Identifier") &&
      context.scopes.symbolFor(argument) !== iterationValue) ||
    !isProvenUnmodifiedGlobalNamespaceReference(
      awaited.callee.object,
      "Promise",
      context.scopes,
      "resolve",
      true,
    )
  ) {
    return false;
  }
  const exit = isNodeOfType(guard.consequent, "BlockStatement")
    ? guard.consequent.body.length === 1 && guard.consequent.body[0]
    : guard.consequent;
  if (
    !(isNodeOfType(exit, "ContinueStatement") && !exit.label) &&
    !(isNodeOfType(exit, "ReturnStatement") && !exit.argument)
  ) {
    return false;
  }
  const flag = context.scopes.symbolFor(guard.test);
  if (
    flag?.kind !== "let" ||
    !isNodeOfType(flag.declarationNode, "VariableDeclarator") ||
    flag.declarationNode.id !== flag.bindingIdentifier ||
    !isNodeOfType(flag.initializer, "Literal") ||
    flag.initializer.value !== false ||
    !doesCleanupForceGuardValue(guard.test, true, cleanupWrites, context)
  ) {
    return false;
  }
  const writes = flag.references.filter((reference) => reference.flag !== "read");
  const owner = findEnclosingFunction(flag.declarationNode);
  if (writes.length !== 1 || !owner || !hasCompleteSymbolReferences(flag, owner, context.scopes)) {
    return false;
  }

  let hasDynamicBindingAccess = false;
  walkAst(owner, (child) => {
    if (hasDynamicBindingAccess) return false;
    if (
      isNodeOfType(child, "WithStatement") ||
      (isNodeOfType(child, "Identifier") && child.name === "eval")
    ) {
      hasDynamicBindingAccess = true;
      return false;
    }
  });
  return !hasDynamicBindingAccess;
};

const analyzeAsyncEvents = (
  root: EsTreeNode,
  initialStates: AsyncPathState[],
  context: RuleContext,
  cleanupWrites: ReadonlyMap<string, boolean>,
  abortProtectedControllers: ReadonlySet<string>,
  cancellation: AsyncCancellationAnalysis,
): AsyncStatementAnalysis => {
  let states = initialStates;
  const observesReentry = states.some((state) => state.hasFreshCancellationGuard);
  const events = collectOrderedAsyncEvents(
    root,
    context,
    observesReentry ? cancellation : undefined,
  );
  for (const event of events) {
    if (isNodeOfType(event, "AwaitExpression")) {
      const isAbortProtected = awaitUsesAbortedControllerSignal(
        event,
        abortProtectedControllers,
        context,
      );
      states = states.map((state) => ({
        ...state,
        didSuspend: true,
        hasDominatingGuard: false,
        hasFreshCancellationGuard: false,
        isAbortProtected,
        suspensionNode: event,
      }));
      continue;
    }
    if (isNodeOfType(event, "ForOfStatement") && event.await === true) {
      states = states.map((state) => ({
        ...state,
        didSuspend: true,
        hasDominatingGuard: false,
        hasFreshCancellationGuard: false,
        isAbortProtected: false,
        suspensionNode: event,
      }));
      continue;
    }
    if (
      isNodeOfType(event, "CallExpression") &&
      isStateDispatcherCall(event, context) &&
      states.some(
        (state) =>
          state.didSuspend &&
          !state.hasDominatingGuard &&
          !state.hasFreshCancellationGuard &&
          !state.isAbortProtected &&
          (!state.suspensionNode ||
            (!areNodesOnExclusiveConditionalBranches(state.suspensionNode, event, root) &&
              !areNodesOnContradictoryGuardBranches(state.suspensionNode, event, context.scopes))),
      ) &&
      !isGuardedLoopSetter(event, cleanupWrites, context)
    ) {
      return { states, hasUnsafeSetter: true };
    }
    if (observesReentry) {
      states = states.map((state) => ({ ...state, hasFreshCancellationGuard: false }));
    }
  }
  return { states, hasUnsafeSetter: false };
};

const isNonReentrantCancellationTest = (
  expression: EsTreeNode,
  cancellation: AsyncCancellationAnalysis,
  context: RuleContext,
): boolean => {
  const value = stripParenExpression(expression);
  if (isNodeOfType(value, "Identifier") || isNodeOfType(value, "Literal")) return true;
  if (cancellation.signalReads.has(value)) return true;
  if (isNodeOfType(value, "UnaryExpression") && value.operator === "!") {
    return isNonReentrantCancellationTest(value.argument, cancellation, context);
  }
  if (
    isNodeOfType(value, "LogicalExpression") ||
    (isNodeOfType(value, "BinaryExpression") &&
      (value.operator === "===" || value.operator === "!=="))
  ) {
    return (
      isNonReentrantCancellationTest(value.left, cancellation, context) &&
      isNonReentrantCancellationTest(value.right, cancellation, context)
    );
  }
  if (!isNodeOfType(value, "MemberExpression") || getStaticPropertyName(value) !== "current") {
    return false;
  }
  const receiver = stripParenExpression(value.object);
  if (
    !isNodeOfType(receiver, "Identifier") ||
    !isReactHookResultReference(receiver, REF_HOOKS, null, context.scopes)
  ) {
    return false;
  }
  const ref = context.scopes.symbolFor(receiver);
  return Boolean(
    ref?.kind === "const" &&
    hasCompleteSymbolReferences(ref, context.scopes.rootScope.node, context.scopes) &&
    ref.references.every((reference) => {
      const member = reference.identifier.parent;
      return (
        reference.flag === "read" &&
        isNodeOfType(member, "MemberExpression") &&
        member.object === reference.identifier &&
        getStaticPropertyName(member) === "current"
      );
    }),
  );
};

const whileTestRejectsCleanup = (
  test: EsTreeNode,
  cancellation: AsyncCancellationAnalysis,
  context: RuleContext,
): boolean => {
  if (doesCleanupForceGuardValue(test, false, cancellation.cleanupWrites, context)) return true;
  const condition = stripParenExpression(test);
  if (
    isNodeOfType(condition, "UnaryExpression") &&
    condition.operator === "!" &&
    cancellation.signalReads.has(stripParenExpression(condition.argument))
  ) {
    return true;
  }
  return (
    isNodeOfType(condition, "LogicalExpression") &&
    condition.operator === "&&" &&
    whileTestRejectsCleanup(condition.left, cancellation, context) &&
    isSideEffectFreeGuardExpression(condition.right, context)
  );
};

const testExitsOnCancelledWait = (
  test: EsTreeNode,
  cancellation: AsyncCancellationAnalysis,
  context: RuleContext,
): boolean => {
  if (cancellation.guardedWaitCalls.size === 0) return false;
  const condition = stripParenExpression(test);
  if (isNodeOfType(condition, "UnaryExpression") && condition.operator === "!") {
    const argument = stripParenExpression(condition.argument);
    return (
      isNodeOfType(argument, "AwaitExpression") &&
      cancellation.guardedWaitCalls.has(stripParenExpression(argument.argument))
    );
  }
  return (
    isNodeOfType(condition, "LogicalExpression") &&
    condition.operator === "||" &&
    testExitsOnCancelledWait(condition.left, cancellation, context) &&
    isNonReentrantCancellationTest(condition.right, cancellation, context)
  );
};

const supportsStructuredWhileBody = (body: EsTreeNode): boolean => {
  let supported = true;
  walkWithoutNestedFunctions(body, (node) => {
    if (
      node.type === "WhileStatement" ||
      node.type === "DoWhileStatement" ||
      node.type === "ForStatement" ||
      node.type === "ForOfStatement" ||
      node.type === "ForInStatement" ||
      node.type === "SwitchStatement" ||
      node.type === "TryStatement" ||
      node.type === "LabeledStatement" ||
      node.type === "WithStatement" ||
      ((isNodeOfType(node, "ContinueStatement") || isNodeOfType(node, "BreakStatement")) &&
        node.label)
    ) {
      supported = false;
      return false;
    }
    return undefined;
  });
  return supported;
};

const analyzeAsyncStatements = (
  statements: EsTreeNode[],
  initialStates: AsyncPathState[],
  context: RuleContext,
  cleanupWrites: ReadonlyMap<string, boolean>,
  abortProtectedControllers: ReadonlySet<string>,
  sequenceSnapshots: ReadonlyMap<string, SequenceSnapshot>,
  cancellation: AsyncCancellationAnalysis,
): AsyncStatementAnalysis => {
  let states = initialStates;
  for (const statement of statements) {
    if (states.length === 0) break;
    if (cancellation.transfers && isNodeOfType(statement, "ContinueStatement")) {
      cancellation.transfers.continues.push(...states);
      states = [];
      continue;
    }
    if (cancellation.transfers && isNodeOfType(statement, "BreakStatement")) {
      cancellation.transfers.breaks.push(...states);
      states = [];
      continue;
    }
    if (
      isNodeOfType(statement, "WhileStatement") &&
      isNonReentrantCancellationTest(statement.test, cancellation, context) &&
      whileTestRejectsCleanup(statement.test, cancellation, context) &&
      supportsStructuredWhileBody(statement.body)
    ) {
      const loop = analyzeGuardedWhile(
        statement,
        states,
        context,
        cleanupWrites,
        abortProtectedControllers,
        sequenceSnapshots,
        cancellation,
      );
      if (loop.hasUnsafeSetter) return loop;
      states = loop.states;
      continue;
    }
    if (isNodeOfType(statement, "ReturnStatement") || isNodeOfType(statement, "ThrowStatement")) {
      if (statement.argument) {
        const returned = analyzeAsyncEvents(
          statement.argument,
          states,
          context,
          cleanupWrites,
          abortProtectedControllers,
          cancellation,
        );
        if (returned.hasUnsafeSetter) return returned;
      }
      states = [];
      continue;
    }
    if (isNodeOfType(statement, "BlockStatement")) {
      const nested = analyzeAsyncStatements(
        statement.body as EsTreeNode[],
        states,
        context,
        cleanupWrites,
        abortProtectedControllers,
        sequenceSnapshots,
        cancellation,
      );
      if (nested.hasUnsafeSetter) return nested;
      states = nested.states;
      continue;
    }
    if (isNodeOfType(statement, "IfStatement")) {
      const tested = analyzeAsyncEvents(
        statement.test,
        states,
        context,
        cleanupWrites,
        abortProtectedControllers,
        cancellation,
      );
      if (tested.hasUnsafeSetter) return tested;
      states = tested.states;
      if (
        !cancellation.transfers &&
        !statement.alternate &&
        isEarlyExitStatement(statement.consequent)
      ) {
        const doesCleanupForceExit = doesCleanupForceGuardValue(
          statement.test,
          true,
          cleanupWrites,
          context,
        );
        const doesSequenceMismatchForceExit = doesSequenceMismatchForceGuardValue(
          statement.test,
          true,
          sequenceSnapshots,
          context,
        );
        if (doesCleanupForceExit || doesSequenceMismatchForceExit) {
          states = states.map((state) => ({
            ...state,
            hasDominatingGuard:
              state.hasDominatingGuard ||
              (state.didSuspend && (doesCleanupForceExit || doesSequenceMismatchForceExit)),
          }));
          continue;
        }
      }
      const branchCleanupWrites = cancellation.transfers
        ? cancellation.cleanupWrites
        : cleanupWrites;
      const doesCleanupPreventProceed = doesCleanupForceGuardValue(
        statement.test,
        false,
        branchCleanupWrites,
        context,
      );
      const doesSequenceMismatchPreventProceed =
        !cancellation.transfers &&
        doesSequenceMismatchForceGuardValue(statement.test, false, sequenceSnapshots, context);
      const consequent = analyzeAsyncStatements(
        isNodeOfType(statement.consequent, "BlockStatement")
          ? (statement.consequent.body as EsTreeNode[])
          : [statement.consequent as EsTreeNode],
        states.map((state) => ({
          ...state,
          hasDominatingGuard:
            state.hasDominatingGuard ||
            (!cancellation.transfers &&
              state.didSuspend &&
              (doesCleanupPreventProceed || doesSequenceMismatchPreventProceed)),
          hasFreshCancellationGuard:
            state.hasFreshCancellationGuard ||
            (Boolean(cancellation.transfers) &&
              state.didSuspend &&
              doesCleanupPreventProceed &&
              isNonReentrantCancellationTest(statement.test, cancellation, context)),
        })),
        context,
        cleanupWrites,
        abortProtectedControllers,
        sequenceSnapshots,
        cancellation,
      );
      if (consequent.hasUnsafeSetter) return consequent;
      const alternateIsGuarded =
        testExitsOnCancelledWait(statement.test, cancellation, context) ||
        (Boolean(cancellation.transfers) &&
          doesCleanupForceGuardValue(statement.test, true, cancellation.cleanupWrites, context) &&
          isNonReentrantCancellationTest(statement.test, cancellation, context));
      const alternateStates = states.map((state) => ({
        ...state,
        hasFreshCancellationGuard:
          state.hasFreshCancellationGuard || (state.didSuspend && alternateIsGuarded),
      }));
      const alternate = statement.alternate
        ? analyzeAsyncStatements(
            isNodeOfType(statement.alternate, "BlockStatement")
              ? (statement.alternate.body as EsTreeNode[])
              : [statement.alternate as EsTreeNode],
            alternateStates,
            context,
            cleanupWrites,
            abortProtectedControllers,
            sequenceSnapshots,
            cancellation,
          )
        : { states: alternateStates, hasUnsafeSetter: false };
      if (alternate.hasUnsafeSetter) return alternate;
      states = [...consequent.states, ...alternate.states];
      states = dedupeAsyncPathStates(states);
      continue;
    }
    if (isNodeOfType(statement, "SwitchStatement")) {
      const discriminated = analyzeAsyncEvents(
        statement.discriminant,
        states,
        context,
        cleanupWrites,
        abortProtectedControllers,
        cancellation,
      );
      if (discriminated.hasUnsafeSetter) return discriminated;
      const switchStates: AsyncPathState[] = [];
      for (let caseIndex = 0; caseIndex < statement.cases.length; caseIndex += 1) {
        const switched = analyzeAsyncStatements(
          collectSwitchPathStatements(statement.cases, caseIndex),
          discriminated.states.map((state) => ({ ...state })),
          context,
          cleanupWrites,
          abortProtectedControllers,
          sequenceSnapshots,
          cancellation,
        );
        if (switched.hasUnsafeSetter) return switched;
        switchStates.push(...switched.states);
      }
      if (!statement.cases.some((switchCase) => switchCase.test === null)) {
        switchStates.push(...discriminated.states.map((state) => ({ ...state })));
      }
      states = dedupeAsyncPathStates(switchStates);
      continue;
    }
    if (isNodeOfType(statement, "ForOfStatement") && statement.await === true) {
      const suspendedStates = states.map((state) => ({
        ...state,
        didSuspend: true,
        hasDominatingGuard: false,
        isAbortProtected: false,
        suspensionNode: statement,
      }));
      const body = analyzeAsyncStatements(
        isNodeOfType(statement.body, "BlockStatement")
          ? (statement.body.body as EsTreeNode[])
          : [statement.body as EsTreeNode],
        suspendedStates,
        context,
        cleanupWrites,
        abortProtectedControllers,
        sequenceSnapshots,
        cancellation,
      );
      if (body.hasUnsafeSetter) return body;
      states = [...states, ...body.states];
      continue;
    }
    if (isNodeOfType(statement, "TryStatement")) {
      const tried = analyzeAsyncStatements(
        statement.block.body as EsTreeNode[],
        states,
        context,
        cleanupWrites,
        abortProtectedControllers,
        sequenceSnapshots,
        cancellation,
      );
      if (tried.hasUnsafeSetter) return tried;
      const trySuspension = collectOrderedAsyncEvents(statement.block, context).find(
        (event) =>
          isNodeOfType(event, "AwaitExpression") ||
          (isNodeOfType(event, "ForOfStatement") && event.await === true),
      );
      const caught = statement.handler
        ? analyzeAsyncStatements(
            statement.handler.body.body as EsTreeNode[],
            states.map((state) =>
              trySuspension
                ? {
                    ...state,
                    didSuspend: true,
                    hasDominatingGuard: false,
                    isAbortProtected: false,
                    suspensionNode: trySuspension,
                  }
                : { ...state },
            ),
            context,
            cleanupWrites,
            abortProtectedControllers,
            sequenceSnapshots,
            cancellation,
          )
        : { states: [], hasUnsafeSetter: false };
      if (caught.hasUnsafeSetter) return caught;
      states = [...tried.states, ...caught.states];
      states = dedupeAsyncPathStates(states);
      if (statement.finalizer) {
        const finalized = analyzeAsyncStatements(
          statement.finalizer.body as EsTreeNode[],
          states,
          context,
          cleanupWrites,
          abortProtectedControllers,
          sequenceSnapshots,
          cancellation,
        );
        if (finalized.hasUnsafeSetter) return finalized;
        states = finalized.states;
      }
      continue;
    }
    const analyzedEvents = analyzeAsyncEvents(
      statement,
      states,
      context,
      cleanupWrites,
      abortProtectedControllers,
      cancellation,
    );
    if (analyzedEvents.hasUnsafeSetter) return analyzedEvents;
    states = analyzedEvents.states;
  }
  return { states, hasUnsafeSetter: false };
};

const analyzeGuardedWhile = (
  statement: EsTreeNodeOfType<"WhileStatement">,
  initialStates: AsyncPathState[],
  context: RuleContext,
  cleanupWrites: ReadonlyMap<string, boolean>,
  abortProtectedControllers: ReadonlySet<string>,
  sequenceSnapshots: ReadonlyMap<string, SequenceSnapshot>,
  cancellation: AsyncCancellationAnalysis,
): AsyncStatementAnalysis => {
  const body = isNodeOfType(statement.body, "BlockStatement")
    ? statement.body.body
    : [statement.body];
  const exitStates: AsyncPathState[] = [];
  let entries = initialStates;
  let processedSuspendedBackedge = false;
  for (;;) {
    const header = analyzeAsyncEvents(
      statement.test,
      entries,
      context,
      cleanupWrites,
      abortProtectedControllers,
      cancellation,
    );
    if (header.hasUnsafeSetter) return header;
    exitStates.push(...header.states);
    const transfers: WhileTransferStates = { continues: [], breaks: [] };
    const iteration = analyzeAsyncStatements(
      body,
      header.states.map((state) => ({
        ...state,
        hasFreshCancellationGuard: state.hasFreshCancellationGuard || state.didSuspend,
      })),
      context,
      cleanupWrites,
      abortProtectedControllers,
      sequenceSnapshots,
      { ...cancellation, transfers },
    );
    if (iteration.hasUnsafeSetter) return iteration;
    exitStates.push(...transfers.breaks);
    if (
      processedSuspendedBackedge ||
      ![...iteration.states, ...transfers.continues].some((state) => state.didSuspend)
    ) {
      return { states: dedupeAsyncPathStates(exitStates), hasUnsafeSetter: false };
    }
    // Every suspended backedge has the same state at the next guard test.
    entries = [
      {
        didSuspend: true,
        hasDominatingGuard: false,
        isAbortProtected: false,
        suspensionNode: null,
      },
    ];
    processedSuspendedBackedge = true;
  }
};

const getFirstCleanupExpression = (cleanup: EsTreeNode): EsTreeNode | null => {
  if (!isFunctionLike(cleanup)) return null;
  if (!isNodeOfType(cleanup.body, "BlockStatement")) return cleanup.body;
  const first = cleanup.body.body[0];
  return isNodeOfType(first, "ExpressionStatement") ? first.expression : null;
};

const collectOwnedLoopCleanupWrites = (
  effectCallback: EsTreeNode,
  cleanupFunctions: readonly EsTreeNode[],
  cleanupWrites: ReadonlyMap<string, boolean>,
  context: RuleContext,
): ReadonlyMap<string, boolean> => {
  const ownedCleanupWrites = new Map<string, boolean>();
  if (!cleanupWrites.size) return ownedCleanupWrites;
  let hasDynamicBindingAccess = false;
  walkAst(effectCallback, (node) => {
    if (hasDynamicBindingAccess) return false;
    if (
      node.type === "WithStatement" ||
      (isNodeOfType(node, "Identifier") && node.name === "eval")
    ) {
      hasDynamicBindingAccess = true;
      return false;
    }
    return undefined;
  });
  if (hasDynamicBindingAccess) return ownedCleanupWrites;
  walkOwnFunctionScope(effectCallback, (node) => {
    if (
      !isNodeOfType(node, "VariableDeclarator") ||
      !isNodeOfType(node.id, "Identifier") ||
      !isNodeOfType(node.init, "Literal") ||
      typeof node.init.value !== "boolean"
    ) {
      return;
    }
    const key = serializeReferenceKey({ node: node.id, scopes: context.scopes });
    if (!key) return;
    const cleanupValue = cleanupWrites.get(key);
    if (
      cleanupValue === undefined ||
      !cleanupFunctions.every((cleanup) => {
        const expression = getFirstCleanupExpression(cleanup);
        return (
          isNodeOfType(expression, "AssignmentExpression") &&
          expression.operator === "=" &&
          serializeReferenceKey({ node: expression.left, scopes: context.scopes }) === key &&
          isNodeOfType(expression.right, "Literal") &&
          expression.right.value === cleanupValue
        );
      })
    ) {
      return;
    }
    const binding = context.scopes.symbolFor(node.id);
    if (
      !binding ||
      binding.kind !== "let" ||
      !hasCompleteSymbolReferences(binding, effectCallback, context.scopes) ||
      binding.references.some((reference) => {
        if (reference.flag === "read") return false;
        const writer = findEnclosingFunction(reference.identifier);
        const assignment = reference.identifier.parent;
        return (
          !writer ||
          !cleanupFunctions.includes(writer) ||
          !isNodeOfType(assignment, "AssignmentExpression") ||
          assignment.left !== reference.identifier ||
          assignment.operator !== "=" ||
          !isNodeOfType(assignment.right, "Literal") ||
          assignment.right.value !== cleanupValue
        );
      })
    ) {
      return;
    }
    ownedCleanupWrites.set(key, cleanupValue);
  });
  return ownedCleanupWrites;
};

const isReadOnlySignalMember = (member: EsTreeNode): boolean => {
  const outerMember = findTransparentExpressionRoot(member);
  const parent = outerMember.parent;
  return (
    !(isNodeOfType(parent, "AssignmentExpression") && parent.left === outerMember) &&
    !(isNodeOfType(parent, "UpdateExpression") && parent.argument === outerMember) &&
    !(isNodeOfType(parent, "UnaryExpression") && parent.operator === "delete")
  );
};

const collectOwnedCancellationUses = (
  effectCallback: EsTreeNode,
  abortedControllers: ReadonlySet<string>,
  cleanupFunctions: readonly EsTreeNode[],
  context: RuleContext,
): OwnedCancellationUses => {
  const signalReads = new Set<EsTreeNode>();
  const guardedWaitCalls = new Set<EsTreeNode>();
  if (abortedControllers.size === 0) return { signalReads, guardedWaitCalls };
  const waiterResults = new WeakMap<EsTreeNode, boolean>();

  walkOwnFunctionScope(effectCallback, (node) => {
    if (
      !isNodeOfType(node, "VariableDeclarator") ||
      !isNodeOfType(node.id, "Identifier") ||
      !isNodeOfType(node.init, "NewExpression") ||
      node.init.arguments.length !== 0 ||
      !isNodeOfType(node.init.callee, "Identifier") ||
      node.init.callee.name !== "AbortController"
    ) {
      return;
    }
    const controllerKey = serializeReferenceKey({ node: node.id, scopes: context.scopes });
    const controller = context.scopes.symbolFor(node.id);
    if (
      !controllerKey ||
      !abortedControllers.has(controllerKey) ||
      controller?.kind !== "const" ||
      !hasCompleteSymbolReferences(controller, effectCallback, context.scopes) ||
      !isProvenUnmodifiedGlobalNamespaceReference(
        node.init.callee,
        "AbortController",
        context.scopes,
        undefined,
        true,
      )
    ) {
      return;
    }
    if (
      !cleanupFunctions.every((cleanup) => {
        const expression = getFirstCleanupExpression(cleanup);
        if (
          !isNodeOfType(expression, "CallExpression") ||
          expression.optional ||
          expression.arguments.length !== 0 ||
          !isNodeOfType(expression.callee, "MemberExpression") ||
          expression.callee.optional ||
          getStaticPropertyName(expression.callee) !== "abort"
        ) {
          return false;
        }
        return context.scopes.symbolFor(expression.callee.object) === controller;
      })
    ) {
      return;
    }
    let signalIdentifier: EsTreeNode | null = null;
    let abortCallCount = 0;
    for (const reference of controller.references) {
      if (reference.flag !== "read") return;
      const identifier = reference.identifier;
      const parent = identifier.parent;
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === identifier &&
        isNodeOfType(parent.id, "ObjectPattern") &&
        parent.id.properties.length === 1
      ) {
        const property = parent.id.properties[0];
        if (
          signalIdentifier ||
          !isNodeOfType(property, "Property") ||
          property.computed ||
          getStaticPropertyKeyName(property) !== "signal" ||
          !isNodeOfType(property.value, "Identifier")
        ) {
          return;
        }
        signalIdentifier = property.value;
        continue;
      }
      if (
        !isNodeOfType(parent, "MemberExpression") ||
        parent.optional ||
        parent.object !== identifier ||
        getStaticPropertyName(parent) !== "abort" ||
        !isNodeOfType(parent.parent, "CallExpression") ||
        parent.parent.callee !== parent ||
        parent.parent.optional ||
        parent.parent.arguments.length !== 0
      ) {
        return;
      }
      const cleanup = findEnclosingFunction(parent);
      if (!cleanup || !cleanupFunctions.includes(cleanup)) return;
      abortCallCount += 1;
    }
    if (!signalIdentifier || abortCallCount === 0) return;
    const signal = context.scopes.symbolFor(signalIdentifier);
    if (
      signal?.kind !== "const" ||
      !hasCompleteSymbolReferences(signal, effectCallback, context.scopes)
    ) {
      return;
    }
    const localReads: EsTreeNode[] = [];
    const localWaits: EsTreeNode[] = [];
    for (const reference of signal.references) {
      if (reference.flag !== "read") return;
      const identifier = reference.identifier;
      const use = identifier.parent;
      if (
        identifier === signalIdentifier ||
        (use === signalIdentifier.parent &&
          isNodeOfType(use, "Property") &&
          use.shorthand &&
          use.key === identifier)
      ) {
        continue;
      }
      if (
        isNodeOfType(use, "MemberExpression") &&
        !use.optional &&
        use.object === identifier &&
        getStaticPropertyName(use) === "aborted" &&
        isReadOnlySignalMember(use)
      ) {
        localReads.push(use);
        continue;
      }
      if (
        !isNodeOfType(use, "CallExpression") ||
        use.optional ||
        !isNodeOfType(use.callee, "Identifier") ||
        use.arguments.length !== 2 ||
        use.arguments[1] !== identifier ||
        !isNodeOfType(use.arguments[0], "Literal") ||
        typeof use.arguments[0].value !== "number" ||
        !Number.isFinite(use.arguments[0].value) ||
        use.arguments[0].value <= 0 ||
        use.arguments[0].value > 0x7fffffff ||
        !isNodeOfType(findTransparentExpressionRoot(use).parent, "AwaitExpression")
      ) {
        return;
      }
      const waiter = resolveExactLocalFunction(use.callee, context.scopes);
      const waitBinding = context.scopes.symbolFor(use.callee);
      if (
        !waiter ||
        !waitBinding ||
        !hasCompleteSymbolReferences(waitBinding, context.scopes.rootScope.node, context.scopes) ||
        waitBinding.references.some((waitReference) => {
          const call = waitReference.identifier.parent;
          return (
            !isNodeOfType(call, "CallExpression") ||
            call.callee !== waitReference.identifier ||
            !isNodeOfType(call.arguments[1], "Identifier") ||
            context.scopes.symbolFor(call.arguments[1]) !== signal
          );
        })
      ) {
        return;
      }
      const cached = waiterResults.get(waiter);
      const proved = cached ?? isClosedBooleanTimerWaiter(waiter, context);
      waiterResults.set(waiter, proved);
      if (!proved) return;
      localWaits.push(use);
    }
    for (const read of localReads) signalReads.add(read);
    for (const call of localWaits) guardedWaitCalls.add(call);
  });
  return { signalReads, guardedWaitCalls };
};

const hasUnsafePostAwaitSetter = (
  asyncFunction: EsTreeNode,
  effectCallback: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(asyncFunction)) return false;
  const deferredCall = getDeferredEffectCallbackCall(asyncFunction, context.scopes);
  if (deferredCall && !isNodeReachableWithinFunction(deferredCall, context)) return false;
  if (!asyncFunction.async && !deferredCall) return false;
  const firstSuspensionStart = deferredCall
    ? asyncFunction.range[0]
    : findFirstSuspensionStart(asyncFunction);
  if (firstSuspensionStart === null) return false;
  const cleanupFunctions = collectCleanupFunctionsAfterInvocations(
    effectCallback,
    asyncFunction,
    context,
  );
  const cleanupWrites = collectCleanupGuardWrites(cleanupFunctions, context);
  const postSuspensionWrites = collectPostSuspensionWrittenReferenceKeys(
    asyncFunction,
    firstSuspensionStart,
    context,
  );
  for (const targetKey of cleanupWrites.keys()) {
    if (doesPostSuspensionWriteReference(targetKey, postSuspensionWrites)) {
      cleanupWrites.delete(targetKey);
    }
  }
  const declaredControllers = collectAbortControllerKeys(effectCallback, context);
  const abortedControllers = collectCleanupAbortedControllers(cleanupFunctions, context);
  const abortProtectedControllers = new Set(
    [...declaredControllers].filter((controllerName) => abortedControllers.has(controllerName)),
  );
  const sequenceSnapshots = new Map([
    ...collectSequenceSnapshots(effectCallback, firstSuspensionStart, context),
    ...collectSequenceSnapshots(asyncFunction, firstSuspensionStart, context),
  ]);
  for (const [snapshotKey, snapshot] of sequenceSnapshots) {
    if (doesPostSuspensionWriteReference(snapshot.counterKey, postSuspensionWrites)) {
      sequenceSnapshots.delete(snapshotKey);
    }
  }
  const body = asyncFunction.body;
  const statements = isNodeOfType(body, "BlockStatement")
    ? (body.body as EsTreeNode[])
    : [body as EsTreeNode];
  return analyzeAsyncStatements(
    statements,
    [
      {
        didSuspend: Boolean(deferredCall),
        hasDominatingGuard: false,
        isAbortProtected: false,
        suspensionNode: null,
      },
    ],
    context,
    cleanupWrites,
    abortProtectedControllers,
    sequenceSnapshots,
    {
      cleanupWrites: collectOwnedLoopCleanupWrites(
        effectCallback,
        cleanupFunctions,
        cleanupWrites,
        context,
      ),
      ...collectOwnedCancellationUses(
        effectCallback,
        abortProtectedControllers,
        cleanupFunctions,
        context,
      ),
    },
  ).hasUnsafeSetter;
};

export const noSetStateAfterAwaitInEffect = defineRule({
  id: "no-set-state-after-await-in-effect",
  title: "Unguarded asynchronous state update in an effect",
  severity: "warn",
  category: "Bugs",
  recommendation:
    "In an effect whose dependencies can change, guard setters after `await` or inside deferred microtask and Promise callbacks with a cancellation/ignore flag checked after deferral, or return a cleanup that cancels the async work.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (
        !isReactApiCall(node, EFFECT_HOOK_NAMES, context.scopes, {
          allowGlobalReactNamespace: true,
          allowUnboundBareCalls: true,
        })
      ) {
        return;
      }
      const callback = getEffectCallback(node);
      if (!isFunctionLike(callback)) return;
      if (callback.async) return;
      const dependencyArray = getDependencyArray(node);
      if (dependencyArray && hasOnlyStableIdentityDependencies({ dependencyArray, context })) {
        return;
      }
      for (const asyncFunction of collectTransitivelyInvokedFunctions(callback, context)) {
        if (
          asyncFunction !== callback &&
          hasUnsafePostAwaitSetter(asyncFunction, callback, context)
        ) {
          context.report({
            node,
            message: getDeferredEffectCallbackCall(asyncFunction, context.scopes)
              ? DEFERRED_MESSAGE
              : MESSAGE,
          });
          return;
        }
      }
    },
  }),
});
