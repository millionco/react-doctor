import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getCallMethodName } from "../../utils/get-call-method-name.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripGroupingParens } from "../../utils/strip-grouping-parens.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { ScopeDescriptor, SymbolDescriptor } from "../../semantic/scope-analysis.js";

// The `mutate`/`mutateAsync` destructure keys are the near-unique TanStack
// mutation signature, so their presence identifies a mutation result even
// through custom hooks (`useUploadEvent`, `useListAvailableLocales`) and
// `useMutation as useGetXxx` aliases.
const isMutateKey = (name: string): boolean => name === "mutate" || name === "mutateAsync";

// Reading only an acknowledgement field off the response (a genuine write
// confirming its result) is NOT a read-shaped query, so these never count
// as consuming the response body.
const ACK_FIELD_NAMES = new Set(["success", "error", "errors", "ok", "message", "status", "code"]);

// SWR's `const { data, mutate } = useSWR(...)` matches the destructure keys,
// but there `mutate` is the bound revalidate function — calling it in an
// effect while rendering `data` is idiomatic SWR, not a mutation-as-read.
const SWR_HOOK_NAME_PATTERN = /^useSWR/;
const SWR_MODULE_SOURCE_PATTERN = /^swr(\/|$)/;

const NULLISH_COMPARISON_OPERATORS = new Set(["==", "!=", "===", "!=="]);

const findPatternPropertyBinding = (
  pattern: EsTreeNode,
  keyPredicate: (name: string) => boolean,
): EsTreeNode | null => {
  if (!isNodeOfType(pattern, "ObjectPattern")) return null;
  for (const property of pattern.properties) {
    if (!isNodeOfType(property, "Property") || property.computed) continue;
    if (!isNodeOfType(property.key, "Identifier") || !keyPredicate(property.key.name)) continue;
    if (isNodeOfType(property.value, "Identifier")) return property.value;
  }
  return null;
};

// A definitive module source wins over the name heuristic: an `swr` import
// is exempt whatever it's called, and a `useMutation as useSWRFoo` TanStack
// alias stays flagged. The name pattern covers what imports can't decide —
// local SWR wrapper hooks and barrel re-exports.
const isSwrHookResult = (init: EsTreeNodeOfType<"CallExpression">): boolean => {
  const calleeName = getCalleeName(init);
  if (!calleeName) return false;
  const importSource = getImportSourceForName(init, calleeName);
  if (importSource && SWR_MODULE_SOURCE_PATTERN.test(importSource)) return true;
  if (importSource?.startsWith("@tanstack/")) return false;
  return SWR_HOOK_NAME_PATTERN.test(calleeName);
};

// The destructure binding itself (`{ data }` / `{ data: rows }`) is recorded
// as a reference by the scope analyzer, so skip the pattern position — it is
// the declaration, not a consuming read.
const isDestructureBindingPosition = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  return isNodeOfType(parent, "Property") && isNodeOfType(parent.parent, "ObjectPattern");
};

const isAckMemberRead = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  if (!isNodeOfType(parent, "MemberExpression") || parent.object !== identifier) return false;
  return (
    !parent.computed &&
    isNodeOfType(parent.property, "Identifier") &&
    ACK_FIELD_NAMES.has(parent.property.name)
  );
};

const isNullishOperand = (node: EsTreeNode): boolean =>
  (isNodeOfType(node, "Literal") && node.value === null) ||
  (isNodeOfType(node, "Identifier") && node.name === "undefined");

// A bare truthiness/nullish guard (`!data`, `data && ...`, `data ? ... : ...`,
// `if (data)`, `Boolean(data)`, `data != null`) checks that the response
// exists — the pre-optional-chaining spelling of `data?.x` — and does not
// consume the response body.
const isGuardOnlyRead = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") return true;
  if (isNodeOfType(parent, "LogicalExpression") && parent.operator === "&&") {
    return parent.left === identifier;
  }
  if (isNodeOfType(parent, "ConditionalExpression")) return parent.test === identifier;
  if (isNodeOfType(parent, "IfStatement") || isNodeOfType(parent, "WhileStatement")) {
    return parent.test === identifier;
  }
  if (
    isNodeOfType(parent, "CallExpression") &&
    isNodeOfType(parent.callee, "Identifier") &&
    parent.callee.name === "Boolean"
  ) {
    return parent.callee !== identifier;
  }
  if (
    isNodeOfType(parent, "BinaryExpression") &&
    NULLISH_COMPARISON_OPERATORS.has(parent.operator)
  ) {
    const otherOperand = parent.left === identifier ? parent.right : parent.left;
    return isNullishOperand(otherOperand);
  }
  return false;
};

// True when the binding's response body is actually consumed — returned,
// fed to a memo, rendered, or read field-by-field — rather than only
// checked for existence or a success/error acknowledgement.
const symbolHasConsumerRead = (symbol: SymbolDescriptor): boolean =>
  symbol.references.some(
    (reference) =>
      reference.flag !== "write" &&
      !isDestructureBindingPosition(reference.identifier) &&
      !isAckMemberRead(reference.identifier) &&
      !isGuardOnlyRead(reference.identifier),
  );

const objectPatternReadsResponseBody = (pattern: EsTreeNodeOfType<"ObjectPattern">): boolean =>
  pattern.properties.some(
    (property) =>
      isNodeOfType(property, "Property") &&
      !property.computed &&
      isNodeOfType(property.key, "Identifier") &&
      !ACK_FIELD_NAMES.has(property.key.name),
  );

// oxc-parser surfaces `(...)` as a `ParenthesizedExpression`, a node kind
// outside the TSESTree union, so it is matched by string here.
const GROUPING_PARENS_TYPE: string = "ParenthesizedExpression";

const skipGroupingParensUpward = (node: EsTreeNode): EsTreeNode | null | undefined => {
  let current = node.parent;
  while (current && current.type === GROUPING_PARENS_TYPE) current = current.parent;
  return current;
};

const getFunctionBindingIdentifier = (
  functionNode: EsTreeNode,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (isNodeOfType(functionNode, "FunctionDeclaration") && functionNode.id) return functionNode.id;
  const parent = functionNode.parent;
  if (isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")) {
    return parent.id;
  }
  return null;
};

// Only calls on the effect callback's own execution path count as "fired from
// useEffect" — crossing an immediately-invoked wrapper or a local helper the
// effect calls synchronously is fine, but a handler merely *registered* in
// the effect (socket listener, interval, observer) fires per external event,
// not on dependency changes. Returns the invoking effect callback so callers
// can inspect it for run-once semantics.
const findInvokingEffectCallback = (
  node: EsTreeNode,
  context: RuleContext,
  visitedFunctions: Set<EsTreeNode> = new Set(),
): EsTreeNode | null => {
  let current = node.parent;
  while (current) {
    if (isFunctionLike(current)) {
      if (visitedFunctions.has(current)) return null;
      visitedFunctions.add(current);
      const enclosingCall = skipGroupingParensUpward(current);
      if (!isNodeOfType(enclosingCall, "CallExpression")) {
        return findEffectCallbackInvokingHelper(current, context, visitedFunctions);
      }
      if (isHookCall(enclosingCall, EFFECT_HOOK_NAMES)) {
        const effectCallback = enclosingCall.arguments[0];
        return effectCallback && stripGroupingParens(effectCallback) === current ? current : null;
      }
      if (stripGroupingParens(enclosingCall.callee) !== current) return null;
    }
    current = current.parent;
  }
  return null;
};

// A helper that isn't invoked where it's defined still counts as effect-fired
// when the effect body synchronously calls its local binding — but only
// call-position references qualify, so a handler passed by name into a
// registration API (`socket.addEventListener('message', onMessage)`) does not.
// A hoisted `function` name carries two symbol records (enclosing scope +
// own scope for recursion) and external calls land on the enclosing-scope
// record, so resolve by walking the scope chain and matching the binding
// identifier's node identity instead of using `symbolFor`, which returns
// the inner record.
const findEffectCallbackInvokingHelper = (
  functionNode: EsTreeNode,
  context: RuleContext,
  visitedFunctions: Set<EsTreeNode>,
): EsTreeNode | null => {
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) return null;
  let scope: ScopeDescriptor | null = context.scopes.scopeFor(functionNode);
  while (scope) {
    const helperSymbol = scope.symbolsByName.get(bindingIdentifier.name);
    if (helperSymbol?.bindingIdentifier === bindingIdentifier) {
      for (const reference of helperSymbol.references) {
        const callSite = reference.identifier.parent;
        if (!isNodeOfType(callSite, "CallExpression")) continue;
        if (callSite.callee !== reference.identifier) continue;
        const effectCallback = findInvokingEffectCallback(callSite, context, visitedFunctions);
        if (effectCallback) return effectCallback;
      }
      return null;
    }
    scope = scope.parent;
  }
  return null;
};

// The response lands either in a plain binding (scope-resolve and inspect
// its reads) or a destructure pattern (inspect the destructured keys).
const bindingConsumesResponse = (binding: EsTreeNode, context: RuleContext): boolean => {
  if (isNodeOfType(binding, "Identifier")) {
    const bindingSymbol = context.scopes.symbolFor(binding);
    return Boolean(bindingSymbol && symbolHasConsumerRead(bindingSymbol));
  }
  return isNodeOfType(binding, "ObjectPattern") && objectPatternReadsResponseBody(binding);
};

const awaitedResultConsumesResponse = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const awaitExpression = callNode.parent;
  if (!isNodeOfType(awaitExpression, "AwaitExpression")) return false;
  const declarator = awaitExpression.parent;
  if (!isNodeOfType(declarator, "VariableDeclarator")) return false;
  return bindingConsumesResponse(declarator.id, context);
};

const thenHandlerConsumesResponse = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const memberExpression = callNode.parent;
  if (!isNodeOfType(memberExpression, "MemberExpression") || memberExpression.object !== callNode) {
    return false;
  }
  if (getCallMethodName(memberExpression) !== "then") return false;
  const thenCall = memberExpression.parent;
  if (!isNodeOfType(thenCall, "CallExpression") || thenCall.callee !== memberExpression) {
    return false;
  }
  const handlerArgument = thenCall.arguments[0];
  if (!handlerArgument) return false;
  const handler = stripGroupingParens(handlerArgument);
  if (!isFunctionLike(handler) || !handler.params[0]) return false;
  return bindingConsumesResponse(handler.params[0], context);
};

// `const isHandled = useRef(false); useEffect(() => { if (isHandled.current)
// return; isHandled.current = true; ... mutateAsync(...) })` — a ref latch
// tested in an if and set to `true` gives the effect fire-exactly-once
// semantics: a deliberate one-shot write (submit a payment redirect result),
// not a cacheable read that useQuery could replace.
const effectCallbackHasRunOnceRefLatch = (effectCallback: EsTreeNode): boolean => {
  const latchedRefNames = new Set<string>();
  walkAst(effectCallback, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      child.operator === "=" &&
      isNodeOfType(child.left, "MemberExpression") &&
      !child.left.computed &&
      isNodeOfType(child.left.object, "Identifier") &&
      isNodeOfType(child.left.property, "Identifier") &&
      child.left.property.name === "current" &&
      isNodeOfType(child.right, "Literal") &&
      child.right.value === true
    ) {
      latchedRefNames.add(child.left.object.name);
    }
  });
  if (latchedRefNames.size === 0) return false;
  let testsLatch = false;
  walkAst(effectCallback, (child: EsTreeNode) => {
    if (testsLatch) return false;
    if (!isNodeOfType(child, "IfStatement")) return;
    walkAst(child.test as EsTreeNode, (testChild: EsTreeNode) => {
      if (testsLatch) return false;
      if (
        isNodeOfType(testChild, "MemberExpression") &&
        !testChild.computed &&
        isNodeOfType(testChild.object, "Identifier") &&
        latchedRefNames.has(testChild.object.name) &&
        isNodeOfType(testChild.property, "Identifier") &&
        testChild.property.name === "current"
      ) {
        testsLatch = true;
        return false;
      }
    });
  });
  return testsLatch;
};

// `useEffect(() => { if (isTokenCreated) return; ...; mutate(...) })` —
// an early return on the SAME mutation result's status/data binding gives
// the effect run-once semantics: this is a deliberate on-mount write
// (create a token, then display it), not a cacheable read that useQuery
// could replace.
const RUN_ONCE_STATUS_KEYS = new Set(["isSuccess", "isPending", "isLoading", "data"]);

const isInsideEffectEarlyReturnTest = (identifier: EsTreeNode): boolean => {
  let child: EsTreeNode = identifier;
  let ancestor: EsTreeNode | null | undefined = identifier.parent;
  let sawEarlyReturnTest = false;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      ancestor.test === child &&
      isEarlyExitStatement(ancestor.consequent)
    ) {
      sawEarlyReturnTest = true;
    }
    if (isFunctionLike(ancestor)) {
      const enclosingCall = skipGroupingParensUpward(ancestor);
      return Boolean(
        sawEarlyReturnTest &&
        isNodeOfType(enclosingCall, "CallExpression") &&
        isHookCall(enclosingCall, EFFECT_HOOK_NAMES),
      );
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const effectGatesOnOwnMutationResult = (
  declaratorId: EsTreeNode,
  context: RuleContext,
): boolean => {
  for (const statusKey of RUN_ONCE_STATUS_KEYS) {
    const statusBinding = findPatternPropertyBinding(declaratorId, (name) => name === statusKey);
    if (!statusBinding) continue;
    const statusSymbol = context.scopes.symbolFor(statusBinding);
    if (!statusSymbol) continue;
    if (
      statusSymbol.references.some((reference) =>
        isInsideEffectEarlyReturnTest(reference.identifier),
      )
    ) {
      return true;
    }
  }
  return false;
};

export const queryNoMutationInEffectAsRead = defineRule({
  id: "query-no-mutation-in-effect-as-read",
  title: "Mutation driven from an effect as a read",
  tags: ["test-noise"],
  requires: ["tanstack-query"],
  severity: "warn",
  recommendation:
    "Use `useQuery` with a `queryKey` and `enabled` for GET-shaped reads instead of firing a mutation from `useEffect`, so the response is cached and deduplicated.",
  create: (context: RuleContext) => ({
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!node.init || !isNodeOfType(node.init, "CallExpression")) return;
      const mutateBinding = findPatternPropertyBinding(node.id, isMutateKey);
      if (!mutateBinding) return;
      const hasMutateAsyncKey = Boolean(
        findPatternPropertyBinding(node.id, (name) => name === "mutateAsync"),
      );
      if (!hasMutateAsyncKey && isSwrHookResult(node.init)) return;
      const mutateSymbol = context.scopes.symbolFor(mutateBinding);
      if (!mutateSymbol) return;

      let mutateCalledInEffect = false;
      let effectResultConsumed = false;
      for (const reference of mutateSymbol.references) {
        const callNode = reference.identifier.parent;
        if (
          !callNode ||
          !isNodeOfType(callNode, "CallExpression") ||
          callNode.callee !== reference.identifier
        ) {
          continue;
        }
        const invokingEffectCallback = findInvokingEffectCallback(callNode, context);
        if (!invokingEffectCallback) continue;
        if (effectCallbackHasRunOnceRefLatch(invokingEffectCallback)) continue;
        mutateCalledInEffect = true;
        if (
          awaitedResultConsumesResponse(callNode, context) ||
          thenHandlerConsumesResponse(callNode, context)
        ) {
          effectResultConsumed = true;
        }
      }
      if (!mutateCalledInEffect) return;

      const dataBinding = findPatternPropertyBinding(node.id, (name) => name === "data");
      const dataSymbol = dataBinding ? context.scopes.symbolFor(dataBinding) : null;
      const dataConsumed = Boolean(dataSymbol && symbolHasConsumerRead(dataSymbol));

      if (!dataConsumed && !effectResultConsumed) return;
      if (effectGatesOnOwnMutationResult(node.id, context)) return;

      context.report({
        node: node.init,
        message:
          "This mutation is fired from `useEffect` and its response is read like a query, so it loses caching and refires on every dependency change — use `useQuery` instead.",
      });
    },
  }),
});
