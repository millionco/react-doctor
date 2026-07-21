import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { areNodesOnExclusiveConditionalBranches } from "../../utils/are-nodes-on-exclusive-conditional-branches.js";
import { areNodesOnContradictoryGuardBranches } from "../../utils/are-nodes-on-contradictory-guard-branches.js";
import { collectEffectInvokedFunctions } from "../../utils/collect-effect-invoked-functions.js";
import { collectReturnedCleanupFunctions } from "../../utils/collect-returned-cleanup-functions.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getReactUseCallbackCall } from "../../utils/get-react-use-callback-call.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isReactHookResultReference } from "../../utils/is-react-hook-result-reference.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { serializeReferenceKey } from "../../utils/serialize-reference-key.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "This setter runs after `await`, so overlapping re-runs of the effect can resolve out of order and write stale state; gate it behind a cancellation/ignore flag or return a cleanup that cancels the work.";

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

const isStateDispatcherCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(callExpression.callee, "Identifier")) return false;
  return isReactHookResultReference(
    callExpression.callee,
    STATE_DISPATCHER_HOOKS,
    1,
    context.scopes,
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

const collectCleanupGuardWrites = (
  effectCallback: EsTreeNode,
  context: RuleContext,
): Map<string, boolean> => {
  const writes = new Map<string, boolean>();
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
    const targetKey = serializeReferenceKey({ node: expression.left, scopes: context.scopes });
    if (targetKey) writes.set(targetKey, assignedValue.value);
  };
  const collectUnconditionalWrites = (statements: EsTreeNode[]): void => {
    for (const statement of statements) {
      if (isNodeOfType(statement, "ExpressionStatement")) {
        recordAssignment(statement);
      } else if (isNodeOfType(statement, "BlockStatement")) {
        collectUnconditionalWrites(statement.body as EsTreeNode[]);
      } else if (isNodeOfType(statement, "TryStatement") && statement.finalizer) {
        collectUnconditionalWrites(statement.finalizer.body as EsTreeNode[]);
      }
    }
  };
  for (const cleanupFunction of collectReturnedCleanupFunctions(effectCallback)) {
    if (!isFunctionLike(cleanupFunction)) continue;
    const body = cleanupFunction.body;
    if (isNodeOfType(body, "BlockStatement")) {
      collectUnconditionalWrites(body.body as EsTreeNode[]);
    } else if (body) {
      recordAssignment(body);
    }
  }
  return writes;
};

const collectCleanupAbortedControllers = (
  effectCallback: EsTreeNode,
  context: RuleContext,
): Set<string> => {
  const controllerKeys = new Set<string>();
  for (const cleanupFunction of collectReturnedCleanupFunctions(effectCallback)) {
    walkOwnFunctionScope(cleanupFunction, (child: EsTreeNode) => {
      if (!isNodeOfType(child, "CallExpression")) return;
      const callee = stripParenExpression(child.callee);
      if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== "abort") {
        return;
      }
      const receiver = stripParenExpression(callee.object);
      const receiverKey = serializeReferenceKey({ node: receiver, scopes: context.scopes });
      if (receiverKey) controllerKeys.add(receiverKey);
    });
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

const getCleanupBackedGuard = (
  test: EsTreeNode,
  cleanupWrites: ReadonlyMap<string, boolean>,
  context: RuleContext,
): string | null => {
  const inner = stripParenExpression(test);
  const isNegated = isNodeOfType(inner, "UnaryExpression") && inner.operator === "!";
  const target = isNegated ? stripParenExpression(inner.argument) : inner;
  const targetKey = serializeReferenceKey({ node: target, scopes: context.scopes });
  if (!targetKey) return null;
  const cleanupValue = cleanupWrites.get(targetKey);
  if (cleanupValue === undefined) return null;
  const exitsWhenValue = !isNegated;
  return cleanupValue === exitsWhenValue ? targetKey : null;
};

const getCleanupBackedProceedGuard = (
  test: EsTreeNode,
  cleanupWrites: ReadonlyMap<string, boolean>,
  context: RuleContext,
): string | null => {
  const inner = stripParenExpression(test);
  const isNegated = isNodeOfType(inner, "UnaryExpression") && inner.operator === "!";
  const target = isNegated ? stripParenExpression(inner.argument) : inner;
  const targetKey = serializeReferenceKey({ node: target, scopes: context.scopes });
  if (!targetKey) return null;
  const cleanupValue = cleanupWrites.get(targetKey);
  if (cleanupValue === undefined) return null;
  const proceedsWhenValue = !isNegated;
  return cleanupValue !== proceedsWhenValue ? targetKey : null;
};

interface SequenceSnapshot {
  counterKey: string;
  start: number;
}

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
      snapshots.set(child.id.name, { counterKey, start });
    }
  });
  return snapshots;
};

const isSequenceGuard = (
  test: EsTreeNode,
  sequenceSnapshots: ReadonlyMap<string, SequenceSnapshot>,
  context: RuleContext,
): boolean => {
  const inner = stripParenExpression(test);
  if (
    !isNodeOfType(inner, "BinaryExpression") ||
    (inner.operator !== "!=" && inner.operator !== "!==")
  ) {
    return false;
  }
  const left = stripParenExpression(inner.left);
  const right = stripParenExpression(inner.right);
  if (isNodeOfType(left, "Identifier")) {
    const snapshot = sequenceSnapshots.get(left.name);
    if (snapshot?.counterKey === serializeReferenceKey({ node: right, scopes: context.scopes })) {
      return true;
    }
  }
  if (isNodeOfType(right, "Identifier")) {
    const snapshot = sequenceSnapshots.get(right.name);
    if (snapshot?.counterKey === serializeReferenceKey({ node: left, scopes: context.scopes })) {
      return true;
    }
  }
  return false;
};

interface AsyncPathState {
  didSuspend: boolean;
  hasDominatingGuard: boolean;
  isAbortProtected: boolean;
  suspensionNode: EsTreeNode | null;
}

const dedupeAsyncPathStates = (states: AsyncPathState[]): AsyncPathState[] => {
  const dedupedStates = new Map<string, AsyncPathState>();
  for (const state of states) {
    const suspensionStart = state.suspensionNode?.range?.[0] ?? "none";
    const key = `${String(state.didSuspend)}:${String(state.hasDominatingGuard)}:${String(state.isAbortProtected)}:${String(suspensionStart)}`;
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

const collectOrderedAsyncEvents = (root: EsTreeNode, context: RuleContext): EsTreeNode[] => {
  const events: EsTreeNode[] = [];
  walkWithoutNestedFunctions(root, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "AwaitExpression") ||
      (isNodeOfType(child, "ForOfStatement") && child.await === true) ||
      (isNodeOfType(child, "CallExpression") && isStateDispatcherCall(child, context))
    ) {
      events.push(child);
    }
  });
  return events.sort(
    (left, right) => ((left as { end?: number }).end ?? 0) - ((right as { end?: number }).end ?? 0),
  );
};

const analyzeAsyncEvents = (
  root: EsTreeNode,
  initialStates: AsyncPathState[],
  context: RuleContext,
  abortProtectedControllers: ReadonlySet<string>,
): { states: AsyncPathState[]; hasUnsafeSetter: boolean } => {
  let states = initialStates;
  for (const event of collectOrderedAsyncEvents(root, context)) {
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
        isAbortProtected: false,
        suspensionNode: event,
      }));
      continue;
    }
    if (
      isNodeOfType(event, "CallExpression") &&
      states.some(
        (state) =>
          state.didSuspend &&
          !state.hasDominatingGuard &&
          !state.isAbortProtected &&
          (!state.suspensionNode ||
            (!areNodesOnExclusiveConditionalBranches(state.suspensionNode, event, root) &&
              !areNodesOnContradictoryGuardBranches(state.suspensionNode, event, context.scopes))),
      )
    ) {
      return { states, hasUnsafeSetter: true };
    }
  }
  return { states, hasUnsafeSetter: false };
};

const analyzeAsyncStatements = (
  statements: EsTreeNode[],
  initialStates: AsyncPathState[],
  context: RuleContext,
  cleanupWrites: ReadonlyMap<string, boolean>,
  abortProtectedControllers: ReadonlySet<string>,
  sequenceSnapshots: ReadonlyMap<string, SequenceSnapshot>,
): { states: AsyncPathState[]; hasUnsafeSetter: boolean } => {
  let states = initialStates;
  for (const statement of statements) {
    if (states.length === 0) break;
    if (isNodeOfType(statement, "ReturnStatement") || isNodeOfType(statement, "ThrowStatement")) {
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
      );
      if (nested.hasUnsafeSetter) return nested;
      states = nested.states;
      continue;
    }
    if (isNodeOfType(statement, "IfStatement")) {
      const tested = analyzeAsyncEvents(statement.test, states, context, abortProtectedControllers);
      if (tested.hasUnsafeSetter) return tested;
      states = tested.states;
      if (!statement.alternate && isEarlyExitStatement(statement.consequent)) {
        const guardKey = getCleanupBackedGuard(statement.test, cleanupWrites, context);
        const isLatestSequenceGuard = isSequenceGuard(statement.test, sequenceSnapshots, context);
        if (guardKey || isLatestSequenceGuard) {
          states = states.map((state) => ({
            ...state,
            hasDominatingGuard:
              state.hasDominatingGuard ||
              (state.didSuspend && Boolean(guardKey || isLatestSequenceGuard)),
          }));
          continue;
        }
      }
      const proceedGuard = getCleanupBackedProceedGuard(statement.test, cleanupWrites, context);
      const consequent = analyzeAsyncStatements(
        isNodeOfType(statement.consequent, "BlockStatement")
          ? (statement.consequent.body as EsTreeNode[])
          : [statement.consequent as EsTreeNode],
        states.map((state) => ({
          ...state,
          hasDominatingGuard:
            state.hasDominatingGuard || (state.didSuspend && Boolean(proceedGuard)),
        })),
        context,
        cleanupWrites,
        abortProtectedControllers,
        sequenceSnapshots,
      );
      if (consequent.hasUnsafeSetter) return consequent;
      const alternate = statement.alternate
        ? analyzeAsyncStatements(
            isNodeOfType(statement.alternate, "BlockStatement")
              ? (statement.alternate.body as EsTreeNode[])
              : [statement.alternate as EsTreeNode],
            states.map((state) => ({ ...state })),
            context,
            cleanupWrites,
            abortProtectedControllers,
            sequenceSnapshots,
          )
        : { states: states.map((state) => ({ ...state })), hasUnsafeSetter: false };
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
        abortProtectedControllers,
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
      abortProtectedControllers,
    );
    if (analyzedEvents.hasUnsafeSetter) return analyzedEvents;
    states = analyzedEvents.states;
  }
  return { states, hasUnsafeSetter: false };
};

const collectInvokedAsyncFunctions = (
  effectCallback: EsTreeNode,
  context: RuleContext,
): Set<EsTreeNode> => {
  const invokedFunctions = collectEffectInvokedFunctions(effectCallback, context.scopes);
  const pendingFunctions = [...invokedFunctions];
  while (pendingFunctions.length > 0) {
    const currentFunction = pendingFunctions.pop();
    if (!currentFunction) break;
    walkOwnFunctionScope(currentFunction, (child: EsTreeNode) => {
      if (!isNodeOfType(child, "CallExpression")) return;
      const callee = stripParenExpression(child.callee);
      if (!isNodeOfType(callee, "Identifier")) return;
      const resolvedFunction = resolveExactLocalFunction(callee, context.scopes);
      if (
        !resolvedFunction ||
        !isFunctionLike(resolvedFunction) ||
        invokedFunctions.has(resolvedFunction)
      ) {
        return;
      }
      invokedFunctions.add(resolvedFunction);
      pendingFunctions.push(resolvedFunction);
    });
  }
  return invokedFunctions;
};

const hasUnsafePostAwaitSetter = (
  asyncFunction: EsTreeNode,
  effectCallback: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(asyncFunction) || !asyncFunction.async) return false;
  const firstSuspensionStart = findFirstSuspensionStart(asyncFunction);
  if (firstSuspensionStart === null) return false;
  const cleanupWrites = collectCleanupGuardWrites(effectCallback, context);
  const declaredControllers = collectAbortControllerKeys(effectCallback, context);
  const abortedControllers = collectCleanupAbortedControllers(effectCallback, context);
  const abortProtectedControllers = new Set(
    [...declaredControllers].filter((controllerName) => abortedControllers.has(controllerName)),
  );
  const sequenceSnapshots = new Map([
    ...collectSequenceSnapshots(effectCallback, firstSuspensionStart, context),
    ...collectSequenceSnapshots(asyncFunction, firstSuspensionStart, context),
  ]);
  const body = asyncFunction.body;
  const statements = isNodeOfType(body, "BlockStatement")
    ? (body.body as EsTreeNode[])
    : [body as EsTreeNode];
  return analyzeAsyncStatements(
    statements,
    [
      {
        didSuspend: false,
        hasDominatingGuard: false,
        isAbortProtected: false,
        suspensionNode: null,
      },
    ],
    context,
    cleanupWrites,
    abortProtectedControllers,
    sequenceSnapshots,
  ).hasUnsafeSetter;
};

export const noSetStateAfterAwaitInEffect = defineRule({
  id: "no-set-state-after-await-in-effect",
  title: "State update after await in an effect",
  severity: "warn",
  category: "Bugs",
  recommendation:
    "In a `useEffect` whose dependencies can change, guard any setter call that runs after an `await` behind a cancellation/ignore flag, or return a cleanup that cancels the async work.",
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
      for (const asyncFunction of collectInvokedAsyncFunctions(callback, context)) {
        if (
          asyncFunction !== callback &&
          hasUnsafePostAwaitSetter(asyncFunction, callback, context)
        ) {
          context.report({ node, message: MESSAGE });
          return;
        }
      }
    },
  }),
});
