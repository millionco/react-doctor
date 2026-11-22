import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../utils/is-proven-unmodified-global-namespace-reference.js";
import { defineRule } from "../../utils/define-rule.js";
import { areNodesOnExclusiveConditionalBranches } from "../../utils/are-nodes-on-exclusive-conditional-branches.js";
import { areNodesOnContradictoryGuardBranches } from "../../utils/are-nodes-on-contradictory-guard-branches.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isReactHookResultReference } from "../../utils/is-react-hook-result-reference.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const MESSAGE =
  "This async handler awaits a mutating request and only flips state after the await, so a fast double-click or double Enter fires the request twice. Add a leading `if (busy) return` guard (or set a flag before the await and disable the control) to close the re-entry window.";

const REENTRY_GUARDED_EVENT_HANDLER_NAMES = new Set(["onClick", "onSubmit"]);
const MUTATING_REQUEST_METHOD_NAMES = new Set([
  "post",
  "put",
  "patch",
  "delete",
  "mutate",
  "mutateAsync",
]);
const MUTATING_FETCH_HTTP_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const STATE_SETTER_NAME_PATTERN = /^set[A-Z]/;
const LOCAL_STORAGE_RECEIVER_NAME_PATTERN = /^(?:db|idb|database|caches?|store)$/i;
const REENTRY_GUARD_NAME_PATTERN =
  /busy|loading|submitting|saving|pending|processing|uploading|disabled|inflight|working/i;
const STATE_DISPATCHER_HOOK_NAMES = new Set(["useState", "useReducer"]);

const getNodeOffset = (node: EsTreeNode, edge: "start" | "end"): number | null => {
  const offset = (node as { start?: unknown; end?: unknown })[edge];
  if (typeof offset === "number") return offset;
  const range = node.range;
  return range ? range[edge === "start" ? 0 : 1] : null;
};

const isStateSetterCall = (node: EsTreeNode, context: RuleContext): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  STATE_SETTER_NAME_PATTERN.test(node.callee.name) &&
  isReactHookResultReference(node.callee, STATE_DISPATCHER_HOOK_NAMES, 1, context.scopes);
const NON_MUTATING_ENDPOINT_TAIL_PATTERN =
  /^(?:preview|render|search|query|validate|verify|check|stop|cancel|abort)$/i;

const getStaticRequestUrlTail = (node: EsTreeNodeOfType<"CallExpression">): string | null => {
  const firstArgument = node.arguments?.[0];
  if (!firstArgument) return null;
  const stripped = stripParenExpression(firstArgument);
  if (isNodeOfType(stripped, "Literal") && typeof stripped.value === "string") {
    return stripped.value;
  }
  if (isNodeOfType(stripped, "TemplateLiteral")) {
    const lastQuasi = stripped.quasis[stripped.quasis.length - 1];
    const cooked = lastQuasi?.value?.cooked;
    return typeof cooked === "string" ? cooked : null;
  }
  return null;
};

const targetsNonMutatingEndpoint = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const urlTail = getStaticRequestUrlTail(node);
  if (!urlTail) return false;
  const path = urlTail.split(/[?#]/)[0] ?? "";
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const lastSegment = segments[segments.length - 1];
  return Boolean(lastSegment) && NON_MUTATING_ENDPOINT_TAIL_PATTERN.test(lastSegment);
};

const isMutatingFetchCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "fetch") return false;
  if (!context.scopes.isGlobalReference(node.callee)) return false;
  const optionsArgument = node.arguments?.[1];
  if (!optionsArgument || !isNodeOfType(optionsArgument, "ObjectExpression")) return false;
  return optionsArgument.properties.some((property) => {
    if (!isNodeOfType(property, "Property") || property.computed) return false;
    const key = property.key;
    const keyName = isNodeOfType(key, "Identifier")
      ? key.name
      : isNodeOfType(key, "Literal")
        ? String(key.value)
        : null;
    if (keyName !== "method") return false;
    const value = property.value;
    return (
      isNodeOfType(value, "Literal") &&
      typeof value.value === "string" &&
      MUTATING_FETCH_HTTP_METHODS.has(value.value.toUpperCase())
    );
  });
};

const awaitedExpressionIsMutatingNetworkOp = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): boolean => {
  if (!expression) return false;
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "CallExpression")) return false;
  if (isMutatingFetchCall(stripped, context)) return !targetsNonMutatingEndpoint(stripped);
  const callee = stripped.callee;
  if (isNodeOfType(callee, "MemberExpression")) {
    const methodName = getStaticPropertyName(callee);
    if (methodName && MUTATING_REQUEST_METHOD_NAMES.has(methodName)) {
      if (methodName === "mutate" && (stripped.arguments?.length ?? 0) === 0) {
        return false;
      }
      let receiverBase: EsTreeNode = callee.object as EsTreeNode;
      while (isNodeOfType(receiverBase, "MemberExpression")) {
        receiverBase = receiverBase.object as EsTreeNode;
      }
      if (
        isNodeOfType(receiverBase, "Identifier") &&
        LOCAL_STORAGE_RECEIVER_NAME_PATTERN.test(receiverBase.name)
      ) {
        return false;
      }
      if (targetsNonMutatingEndpoint(stripped)) return false;
      return true;
    }
    return awaitedExpressionIsMutatingNetworkOp(callee.object as EsTreeNode, context);
  }
  return false;
};

const unwrapUseCallback = (expression: EsTreeNode, context: RuleContext): EsTreeNode => {
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "CallExpression")) return stripped;
  if (
    !isReactApiCall(stripped, "useCallback", context.scopes, {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: true,
      resolveNamedAliases: true,
    })
  )
    return stripped;
  const wrappedFunction = stripped.arguments[0];
  return wrappedFunction && isFunctionLike(wrappedFunction) ? wrappedFunction : stripped;
};

const resolveHandlerFunction = (value: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  const unwrappedValue = unwrapUseCallback(value, context);
  if (isInlineFunctionExpression(unwrappedValue)) return unwrappedValue;
  const exactLocalFunction = resolveExactLocalFunction(unwrappedValue, context.scopes);
  if (exactLocalFunction) return exactLocalFunction;
  if (isNodeOfType(unwrappedValue, "Identifier")) {
    const symbol = context.scopes.symbolFor(unwrappedValue);
    if (symbol?.kind !== "const" || !symbol.initializer) return null;
    const unwrappedInitializer = unwrapUseCallback(symbol.initializer, context);
    if (isFunctionLike(unwrappedInitializer)) return unwrappedInitializer;
  }
  return null;
};

const statementIsEarlyExit = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "ReturnStatement") || isNodeOfType(statement, "ThrowStatement")) {
    return true;
  }
  if (isNodeOfType(statement, "BlockStatement")) {
    const lastStatement = statement.body.at(-1);
    return lastStatement ? statementIsEarlyExit(lastStatement) : false;
  }
  return (
    isNodeOfType(statement, "IfStatement") &&
    Boolean(statement.alternate) &&
    statementIsEarlyExit(statement.consequent) &&
    statementIsEarlyExit(statement.alternate as EsTreeNode)
  );
};

const isReentryGuardReference = (test: EsTreeNode): boolean => {
  const inner = stripParenExpression(test);
  if (isNodeOfType(inner, "Identifier")) return REENTRY_GUARD_NAME_PATTERN.test(inner.name);
  if (!isNodeOfType(inner, "MemberExpression")) return false;
  if (REENTRY_GUARD_NAME_PATTERN.test(getStaticPropertyName(inner) ?? "")) return true;
  let receiver = stripParenExpression(inner.object);
  while (isNodeOfType(receiver, "MemberExpression")) {
    if (REENTRY_GUARD_NAME_PATTERN.test(getStaticPropertyName(receiver) ?? "")) return true;
    receiver = stripParenExpression(receiver.object);
  }
  return isNodeOfType(receiver, "Identifier") && REENTRY_GUARD_NAME_PATTERN.test(receiver.name);
};

const getReentryGuardConditionPolarity = (test: EsTreeNode): boolean | null => {
  const inner = stripParenExpression(test);
  if (isReentryGuardReference(inner)) return true;
  if (isNodeOfType(inner, "UnaryExpression") && inner.operator === "!") {
    const argumentPolarity = getReentryGuardConditionPolarity(inner.argument);
    return argumentPolarity === null ? null : !argumentPolarity;
  }
  if (isNodeOfType(inner, "LogicalExpression") && inner.operator === "||") {
    const leftPolarity = getReentryGuardConditionPolarity(inner.left);
    const rightPolarity = getReentryGuardConditionPolarity(inner.right);
    return leftPolarity === true || rightPolarity === true ? true : null;
  }
  if (!isNodeOfType(inner, "BinaryExpression")) return null;
  const left = stripParenExpression(inner.left);
  const right = stripParenExpression(inner.right);
  const guard = isReentryGuardReference(left)
    ? left
    : isReentryGuardReference(right)
      ? right
      : null;
  const booleanValue = guard === left ? right : guard === right ? left : null;
  if (!guard || !isNodeOfType(booleanValue, "Literal") || typeof booleanValue.value !== "boolean") {
    return null;
  }
  if (inner.operator === "==" || inner.operator === "===") return booleanValue.value;
  if (inner.operator === "!=" || inner.operator === "!==") return !booleanValue.value;
  return null;
};

const testIsPositiveReentryGuard = (test: EsTreeNode): boolean =>
  getReentryGuardConditionPolarity(test) === true;

const expressionWritesReentryGuard = (expression: EsTreeNode, context: RuleContext): boolean => {
  if (
    isNodeOfType(expression, "CallExpression") &&
    isNodeOfType(expression.callee, "Identifier") &&
    isStateSetterCall(expression, context)
  ) {
    const firstArgument = expression.arguments?.[0];
    return (
      REENTRY_GUARD_NAME_PATTERN.test(expression.callee.name) &&
      isNodeOfType(firstArgument, "Literal") &&
      firstArgument.value === true
    );
  }
  if (!isNodeOfType(expression, "AssignmentExpression") || expression.operator !== "=") {
    return false;
  }
  const assignedValue = stripParenExpression(expression.right);
  if (!isNodeOfType(assignedValue, "Literal") || assignedValue.value !== true) return false;
  const target = stripParenExpression(expression.left);
  return (
    isNodeOfType(target, "MemberExpression") &&
    (getStaticPropertyName(target) === "disabled" || getStaticPropertyName(target) === "current")
  );
};

const collectOrderedHandlerEvents = (root: EsTreeNode, context: RuleContext): EsTreeNode[] => {
  const events: EsTreeNode[] = [];
  walkAst(root, (child: EsTreeNode) => {
    if (child !== root && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "AwaitExpression") || isStateSetterCall(child, context)) {
      events.push(child);
    }
  });
  return events.sort(
    (left, right) => (getNodeOffset(left, "end") ?? 0) - (getNodeOffset(right, "end") ?? 0),
  );
};

interface HandlerPathState {
  hasReentryGuard: boolean;
  mutatingAwait: EsTreeNode | null;
}

const dedupeHandlerPathStates = (states: HandlerPathState[]): HandlerPathState[] => {
  const dedupedStates = new Map<string, HandlerPathState>();
  for (const state of states) {
    const key = `${String(state.hasReentryGuard)}:${String(Boolean(state.mutatingAwait))}`;
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

const analyzeHandlerStatements = (
  statements: EsTreeNode[],
  initialStates: HandlerPathState[],
  context: RuleContext,
): { states: HandlerPathState[]; unsafeAwait: EsTreeNode | null } => {
  let states = initialStates;
  for (const statement of statements) {
    if (states.length === 0) break;
    if (isNodeOfType(statement, "ReturnStatement") || isNodeOfType(statement, "ThrowStatement")) {
      states = [];
      continue;
    }
    if (isNodeOfType(statement, "BlockStatement")) {
      const nested = analyzeHandlerStatements(statement.body as EsTreeNode[], states, context);
      if (nested.unsafeAwait) return nested;
      states = nested.states;
      continue;
    }
    if (isNodeOfType(statement, "IfStatement")) {
      if (
        !statement.alternate &&
        statementIsEarlyExit(statement.consequent) &&
        testIsPositiveReentryGuard(statement.test)
      ) {
        states = states.map((state) => ({ ...state, hasReentryGuard: true }));
        continue;
      }
      const consequent = analyzeHandlerStatements(
        isNodeOfType(statement.consequent, "BlockStatement")
          ? (statement.consequent.body as EsTreeNode[])
          : [statement.consequent as EsTreeNode],
        states.map((state) => ({ ...state })),
        context,
      );
      if (consequent.unsafeAwait) return consequent;
      const alternate = statement.alternate
        ? analyzeHandlerStatements(
            isNodeOfType(statement.alternate, "BlockStatement")
              ? (statement.alternate.body as EsTreeNode[])
              : [statement.alternate as EsTreeNode],
            states.map((state) => ({ ...state })),
            context,
          )
        : { states: states.map((state) => ({ ...state })), unsafeAwait: null };
      if (alternate.unsafeAwait) return alternate;
      states = [...consequent.states, ...alternate.states];
      states = dedupeHandlerPathStates(states);
      continue;
    }
    if (isNodeOfType(statement, "SwitchStatement")) {
      const switchStates: HandlerPathState[] = [];
      for (let caseIndex = 0; caseIndex < statement.cases.length; caseIndex += 1) {
        const switched = analyzeHandlerStatements(
          collectSwitchPathStatements(statement.cases, caseIndex),
          states.map((state) => ({ ...state })),
          context,
        );
        if (switched.unsafeAwait) return switched;
        switchStates.push(...switched.states);
      }
      if (!statement.cases.some((switchCase) => switchCase.test === null)) {
        switchStates.push(...states.map((state) => ({ ...state })));
      }
      states = dedupeHandlerPathStates(switchStates);
      continue;
    }
    if (isNodeOfType(statement, "TryStatement")) {
      const tried = analyzeHandlerStatements(statement.block.body as EsTreeNode[], states, context);
      if (tried.unsafeAwait) return tried;
      const caught = statement.handler
        ? analyzeHandlerStatements(
            statement.handler.body.body as EsTreeNode[],
            tried.states.map((state) => ({ ...state })),
            context,
          )
        : { states: [], unsafeAwait: null };
      if (caught.unsafeAwait) return caught;
      states = [...tried.states, ...caught.states];
      states = dedupeHandlerPathStates(states);
      if (statement.finalizer) {
        const finalized = analyzeHandlerStatements(
          statement.finalizer.body as EsTreeNode[],
          states,
          context,
        );
        if (finalized.unsafeAwait) return finalized;
        states = finalized.states;
      }
      continue;
    }
    const events = collectOrderedHandlerEvents(statement, context);
    for (const event of events) {
      if (isNodeOfType(event, "AwaitExpression")) {
        if (awaitedExpressionIsMutatingNetworkOp(event.argument, context)) {
          states = states.map((state) =>
            state.hasReentryGuard ? state : { ...state, mutatingAwait: event },
          );
        }
        continue;
      }
      if (
        states.some(
          (state) =>
            state.mutatingAwait &&
            !areNodesOnExclusiveConditionalBranches(state.mutatingAwait, event, statement) &&
            !areNodesOnContradictoryGuardBranches(state.mutatingAwait, event, context.scopes),
        )
      ) {
        return {
          states,
          unsafeAwait:
            states.find(
              (state) =>
                state.mutatingAwait &&
                !areNodesOnExclusiveConditionalBranches(state.mutatingAwait, event, statement) &&
                !areNodesOnContradictoryGuardBranches(state.mutatingAwait, event, context.scopes),
            )?.mutatingAwait ?? null,
        };
      }
    }
    if (
      isNodeOfType(statement, "ExpressionStatement") &&
      expressionWritesReentryGuard(statement.expression as EsTreeNode, context)
    ) {
      states = states.map((state) => ({ ...state, hasReentryGuard: true }));
    }
  }
  return { states, unsafeAwait: null };
};

// Limit this proof to a native operation whose argument evaluation cannot call user code.
const isLeadingBrowserFetch = (expression: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(expression, "CallExpression") || expression.optional) return false;
  const { callee, arguments: args } = expression;
  if (
    !isNodeOfType(callee, "Identifier") ||
    callee.name !== "fetch" ||
    !isProvenUnmodifiedGlobalNamespaceReference(callee, "fetch", context.scopes, undefined, true) ||
    !isNodeOfType(args[0], "Literal") ||
    typeof args[0].value !== "string" ||
    args.length > 2
  )
    return false;
  const options = args[1];
  if (
    options &&
    (!isNodeOfType(options, "ObjectExpression") ||
      !options.properties.every(
        (property) =>
          isNodeOfType(property, "Property") &&
          property.kind === "init" &&
          !property.computed &&
          !property.method &&
          getStaticPropertyKeyName(property) !== "__proto__" &&
          isNodeOfType(property.value, "Literal") &&
          typeof property.value.value === "string",
      ))
  )
    return false;

  return true;
};

// The same local state that the handler sets must disable its only native trigger.
const hasLeadingNativeButtonDisable = (
  handler: EsTreeNode,
  handlerValue: EsTreeNode,
  handlerAttribute: EsTreeNodeOfType<"JSXAttribute">,
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    opening.name.name !== "button" ||
    getAuthoritativeJsxAttribute(opening.attributes, "onClick") !== handlerAttribute ||
    !isNodeOfType(handler, "ArrowFunctionExpression") ||
    !handler.async ||
    !isNodeOfType(handler.body, "BlockStatement") ||
    !isNodeOfType(handlerValue, "Identifier")
  )
    return false;
  const disabled = getAuthoritativeJsxAttribute(opening.attributes, "disabled")?.value;
  if (
    !isNodeOfType(disabled, "JSXExpressionContainer") ||
    !isNodeOfType(disabled.expression, "Identifier")
  )
    return false;
  const root = findProgramRoot(handler);
  const owner = findEnclosingFunction(handler);
  const { scopes } = context;
  const trigger = scopes.symbolFor(handlerValue);
  if (
    !root ||
    !owner ||
    findEnclosingFunction(opening) !== owner ||
    trigger?.kind !== "const" ||
    trigger.initializer !== handler ||
    trigger.references.length !== 1 ||
    trigger.references[0]?.identifier !== handlerValue ||
    !hasCompleteSymbolReferences(trigger, root, scopes)
  )
    return false;

  const flag = scopes.symbolFor(disabled.expression);
  const tuple = flag?.declarationNode;
  if (
    flag?.kind !== "const" ||
    !isNodeOfType(tuple, "VariableDeclarator") ||
    !isNodeOfType(tuple.id, "ArrayPattern") ||
    tuple.id.elements[0] !== flag.bindingIdentifier ||
    !isNodeOfType(tuple.id.elements[1], "Identifier") ||
    findEnclosingFunction(tuple) !== owner ||
    !isNodeOfType(tuple.init, "CallExpression") ||
    !isReactApiCall(tuple.init, "useState", scopes, { resolveNamedAliases: true }) ||
    tuple.init.arguments.length !== 1 ||
    !isNodeOfType(tuple.init.arguments[0], "Literal") ||
    tuple.init.arguments[0].value !== false
  )
    return false;

  const setter = scopes.symbolFor(tuple.id.elements[1]);
  const first = handler.body.body[0];
  if (
    !setter ||
    !isNodeOfType(first, "ExpressionStatement") ||
    !isNodeOfType(first.expression, "CallExpression") ||
    scopes.symbolFor(first.expression.callee) !== setter ||
    first.expression.optional ||
    first.expression.arguments.length !== 1 ||
    !isNodeOfType(first.expression.arguments[0], "Literal") ||
    first.expression.arguments[0].value !== true ||
    !hasCompleteSymbolReferences(setter, root, scopes)
  )
    return false;

  const awaits: EsTreeNodeOfType<"AwaitExpression">[] = [];
  walkAst(handler.body, (child) => {
    if (isFunctionLike(child)) return false;
    if (isNodeOfType(child, "AwaitExpression")) awaits.push(child);
  });
  const [request] = awaits;
  const statement = request?.parent;
  if (!request || awaits.length !== 1 || !isNodeOfType(statement, "ExpressionStatement"))
    return false;
  const next = handler.body.body[1];
  const immediateRequest = isNodeOfType(next, "TryStatement") ? next.block.body[0] : next;
  if (
    statement !== immediateRequest ||
    statement.expression !== request ||
    !isLeadingBrowserFetch(request.argument, context)
  )
    return false;
  return setter.references.every(({ identifier }) => {
    const call = identifier.parent;
    return (
      call === first.expression ||
      (isNodeOfType(call, "CallExpression") &&
        call.callee === identifier &&
        !call.optional &&
        call.arguments.length === 1 &&
        isNodeOfType(call.arguments[0], "Literal") &&
        call.arguments[0].value === false &&
        findEnclosingFunction(call) === handler &&
        call.range[0] > request.range[1])
    );
  });
};

const analyzeAsyncHandler = (context: RuleContext, functionNode: EsTreeNode): void => {
  if (!isFunctionLike(functionNode)) return;
  if (!(functionNode as { async?: boolean }).async) return;
  if (!isNodeOfType(functionNode.body, "BlockStatement")) return;

  const analysis = analyzeHandlerStatements(
    functionNode.body.body as EsTreeNode[],
    [{ hasReentryGuard: false, mutatingAwait: null }],
    context,
  );
  if (analysis.unsafeAwait) context.report({ node: analysis.unsafeAwait, message: MESSAGE });
};

export const noAsyncEventHandlerWithoutReentryGuard = defineRule({
  id: "no-async-event-handler-without-reentry-guard",
  title: "Async mutating handler without re-entry guard",
  severity: "warn",
  recommendation:
    "An async onClick/onSubmit handler on a host control that awaits a mutating request and sets state only afterward stays interactive across the await, so a double-click fires the write twice. Add a leading `if (busy) return` guard, or set a flag before the await inside `try` and reset it in `finally` while the control is disabled.",
  create: (context: RuleContext) => {
    const analyzedFunctions = new WeakSet<EsTreeNode>();
    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        if (!REENTRY_GUARDED_EVENT_HANDLER_NAMES.has(node.name.name)) return;
        const openingElement = node.parent;
        if (
          !openingElement ||
          !isNodeOfType(openingElement, "JSXOpeningElement") ||
          !isNodeOfType(openingElement.name, "JSXIdentifier") ||
          !/^[a-z]/.test(openingElement.name.name)
        ) {
          return;
        }
        const value = node.value;
        if (!value || !isNodeOfType(value, "JSXExpressionContainer")) return;
        const handlerFunction = resolveHandlerFunction(value.expression as EsTreeNode, context);
        if (!handlerFunction || analyzedFunctions.has(handlerFunction)) return;
        analyzedFunctions.add(handlerFunction);
        if (
          hasLeadingNativeButtonDisable(
            handlerFunction,
            value.expression,
            node,
            openingElement,
            context,
          )
        )
          return;
        analyzeAsyncHandler(context, handlerFunction);
      },
    };
  },
});
