import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { isNamespacedApiCallee } from "../../utils/is-namespaced-api-call.js";
import { isCallResultConsumedAsArgument } from "../../utils/is-call-result-consumed-as-argument.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import {
  DATA_SINK_METHOD_NAMES,
  STRING_READ_METHOD_NAMES,
} from "../../constants/data-sink-method-names.js";
import { getCallMethodName } from "../../utils/get-call-method-name.js";
import { getTransparentReactCallbackWrapperArgument } from "../../utils/get-transparent-react-callback-wrapper-argument.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { Reference } from "eslint-scope";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import {
  getCallExpr,
  getDownstreamRefs,
  getEventualCallRefsTo,
  getUpstreamRefs,
  isSynchronous,
  resolveToFunction,
} from "./utils/effect/ast.js";
import { getProgramAnalysis, type ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  getEffectFn,
  getEffectFnRefs,
  isCustomHookParameter,
  isProp,
  isPropCallbackInvocationRef,
  isState,
  isWholePropsObjectReference,
} from "./utils/effect/react.js";
import { getParentCallbackPropNames } from "./utils/resolve-parent-callback-provenance.js";
import { isCustomHookStateResultReference } from "./utils/is-custom-hook-state-result-reference.js";

const SETTER_NAMED_CALLBACK_PATTERN = /^set[A-Z]/;
const DATA_FETCHING_CALLBACK_PATTERN = /^(fetch|refetch|load|query|request)([A-Z_]|$)/;

const hasMutableBindingWrite = (reference: Reference): boolean =>
  Boolean(
    reference.resolved?.references.some(
      (candidateReference) => candidateReference.isWrite() && !candidateReference.init,
    ),
  );

const getCallCalleeName = (callExpr: EsTreeNode): string | null => {
  if (!isNodeOfType(callExpr, "CallExpression")) return null;
  const callee = callExpr.callee;
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    return callee.property.name;
  }
  return null;
};

// `const valid = isValidRange(range)` / `const ctx = bindSync(doc)` use the
// prop as a pure transform whose result stays local — a read, not a
// notification. The value may flow through conditional / logical branches
// (`el.textContent = isMixed ? 'Mixed' : formatDisplay(v)`) or be returned
// from a helper (`return formatValue(v)`) — the caller consumes it either
// way. Bare statements, guarded calls (`onSync && onSync(x)`), if-test
// reads and concise arrow bodies all remain notifications.
const isCallResultCapturedToLocal = (callExpr: EsTreeNode): boolean => {
  let current: EsTreeNode = callExpr;
  let parent = (current as unknown as { parent?: EsTreeNode | null }).parent;
  while (
    parent &&
    (isNodeOfType(parent, "AwaitExpression") ||
      isNodeOfType(parent, "ChainExpression") ||
      isNodeOfType(parent, "TSAsExpression") ||
      isNodeOfType(parent, "TSNonNullExpression") ||
      (isNodeOfType(parent, "ConditionalExpression") &&
        parent.test !== (current as unknown as typeof parent.test)) ||
      isNodeOfType(parent, "LogicalExpression"))
  ) {
    current = parent;
    parent = (current as unknown as { parent?: EsTreeNode | null }).parent;
  }
  if (!parent) return false;
  if (isNodeOfType(parent, "VariableDeclarator")) {
    return parent.init === (current as unknown as typeof parent.init);
  }
  if (isNodeOfType(parent, "AssignmentExpression")) {
    return parent.right === (current as unknown as typeof parent.right);
  }
  return isNodeOfType(parent, "ReturnStatement");
};

// A prop-callback invocation that actually NOTIFIES the parent: it carries
// arguments (a bare `onEnd()` ping hands nothing up), its result is
// discarded rather than captured locally (a captured result is a transform
// read), and it isn't a data-fetching API (`fetchNextPage(state)` pulls data
// in, it doesn't mirror state up).
const isParentNotificationCallbackRef = (analysis: ProgramAnalysis, ref: Reference): boolean => {
  if (!isPropCallbackInvocationRef(analysis, ref)) return false;
  const callExpr = getCallExpr(ref);
  if (!callExpr || !isNodeOfType(callExpr, "CallExpression")) return false;
  if ((callExpr.arguments ?? []).length === 0) return false;
  if (isCallResultCapturedToLocal(callExpr)) return false;
  const calleeName = getCallCalleeName(callExpr);
  if (calleeName && DATA_FETCHING_CALLBACK_PATTERN.test(calleeName)) return false;
  return true;
};

const isInsideSpreadElement = (identifier: EsTreeNode, root: EsTreeNode): boolean => {
  let node: EsTreeNode | null | undefined = identifier;
  while (node && node !== root) {
    if (isNodeOfType(node, "SpreadElement")) return true;
    node = (node as unknown as { parent?: EsTreeNode | null }).parent;
  }
  return false;
};

// Upstream state provenance that stops at data-providing hook-call
// initializers. A binding produced by a custom hook
// (`const { onDrawerChange, queue } = useDrawers({ state })`) is the hook's
// OUTPUT — walking through it into the hook call's arguments would claim
// every hook input as provenance of every hook output. Wrapper hooks
// (`useMemo(() => amount + 1, [amount])`) stay transparent: their result IS
// a local computation over the referenced state.
const collectUpstreamStateRefs = (
  analysis: ProgramAnalysis,
  ref: Reference,
  stateRefs: Reference[],
  visited: Set<Reference>,
): void => {
  if (visited.has(ref)) return;
  visited.add(ref);
  if (isState(analysis, ref)) {
    stateRefs.push(ref);
    return;
  }
  if (isCustomHookStateResultReference(analysis, ref)) {
    stateRefs.push(ref);
    return;
  }
  for (const def of ref.resolved?.defs ?? []) {
    if (def.type === "ImportBinding" || def.type === "Parameter") continue;
    const defNode = def.node as unknown as EsTreeNode;
    if (!isNodeOfType(defNode, "VariableDeclarator") || !defNode.init) continue;
    const initializer = defNode.init as EsTreeNode;
    const calleeName = getInitializerCalleeName(initializer);
    if (
      calleeName !== null &&
      isReactHookName(calleeName) &&
      !FUNCTION_WRAPPER_HOOK_NAMES.has(calleeName)
    ) {
      continue;
    }
    for (const innerRef of getDownstreamRefs(analysis, initializer)) {
      // `const next = { ...state }` copies state into a fresh object the
      // code then overwrites with new values — handing `next` up gives the
      // parent the freshly computed value, not the live state binding.
      if (isInsideSpreadElement(innerRef.identifier as unknown as EsTreeNode, initializer)) {
        continue;
      }
      collectUpstreamStateRefs(analysis, innerRef, stateRefs, visited);
    }
  }
};

// State refs flowing into the DATA arguments of calls that sit on a path
// to a prop-callback invocation. Restricting to callback-reaching calls is
// what keeps this precise: a raw upstream-arg scan also swallows hook
// wrapper calls (`useCallback(fn, [state])` lists state in a dep array
// without passing it anywhere at runtime) and unrelated local setter calls
// in the same helper. Function-valued arguments are callbacks the callee
// may run later, not data handed to it.
const collectPropCallbackBoundStateRefs = (
  analysis: ProgramAnalysis,
  ref: Reference,
  isPropCallbackRef: (innerRef: Reference) => boolean,
): Reference[] => {
  const stateRefs: Reference[] = [];
  for (const upRef of getUpstreamRefs(analysis, ref)) {
    const callExpr = getCallExpr(upRef);
    if (!callExpr || !isNodeOfType(callExpr, "CallExpression")) continue;
    const reachesPropCallback =
      getEventualCallRefsTo(analysis, upRef, isPropCallbackRef).length > 0;
    if (!reachesPropCallback) continue;
    for (const argument of callExpr.arguments ?? []) {
      if (isFunctionLike(argument as EsTreeNode)) continue;
      for (const argRef of getDownstreamRefs(analysis, argument as EsTreeNode)) {
        if (resolveToFunction(argRef)) continue;
        collectUpstreamStateRefs(analysis, argRef, stateRefs, new Set());
      }
    }
  }
  return stateRefs;
};

const collectDirectCallStateRefs = (
  analysis: ProgramAnalysis,
  callExpression: EsTreeNodeOfType<"CallExpression">,
): Reference[] => {
  const stateReferences: Reference[] = [];
  for (const argument of callExpression.arguments) {
    if (isFunctionLike(argument as EsTreeNode)) continue;
    for (const argumentReference of getDownstreamRefs(analysis, argument as EsTreeNode)) {
      if (resolveToFunction(argumentReference)) continue;
      collectUpstreamStateRefs(analysis, argumentReference, stateReferences, new Set());
    }
  }
  return stateReferences;
};

const getTransparentWrapperPropReference = (
  analysis: ProgramAnalysis,
  reference: Reference,
  context: RuleContext,
): Reference | null => {
  for (const definition of reference.resolved?.defs ?? []) {
    const declarator = definition.node as unknown as EsTreeNode;
    if (
      !isNodeOfType(declarator, "VariableDeclarator") ||
      !isNodeOfType(declarator.id, "Identifier") ||
      !declarator.init
    ) {
      continue;
    }
    const resultSymbol = context.scopes.symbolFor(declarator.id);
    const callbackArgument = getTransparentReactCallbackWrapperArgument(
      declarator.init as EsTreeNode,
      resultSymbol,
      context.scopes,
    );
    if (!callbackArgument) continue;
    const callbackReferences = getDownstreamRefs(analysis, callbackArgument);
    const callbackReference = callbackReferences.find((candidateReference) =>
      isPropCallbackInvocationRef(analysis, candidateReference),
    );
    if (callbackReference) return callbackReference;
    const propReference = callbackReferences.find(
      (candidateReference) =>
        isProp(analysis, candidateReference) &&
        !candidateReference.resolved?.references.some(
          (candidateUsage) => candidateUsage.isWrite() && !candidateUsage.init,
        ),
    );
    if (propReference) return propReference;
  }
  return null;
};

// `setHasMoreItems(result && !result.finished)` — a setter-named callback
// received as a CUSTOM HOOK's parameter stores the computed value in the
// caller's state even when the value isn't the hook's own useState (the
// internxt shape); the hook should return the value instead. The same shape
// on a component prop is the sanctioned lifted-state contract — the parent
// owns the state and delegates the write (delta audit: jaeger LayoutSettings,
// kubetail KubeContextPicker, freecut clip-waveform) — so components require
// real state provenance via collectPropCallbackBoundStateRefs. A literal
// first argument is a field-targeting API (`setValue('address1', '')` from
// react-hook-form), not a data hand-back.
const isSetterNamedCallbackReceivingData = (callbackRef: Reference): boolean => {
  const callExpr = getCallExpr(callbackRef);
  if (!callExpr || !isNodeOfType(callExpr, "CallExpression")) return false;
  const calleeName = getCallCalleeName(callExpr);
  if (!calleeName || !SETTER_NAMED_CALLBACK_PATTERN.test(calleeName)) return false;
  if (!isCustomHookParameter(callbackRef)) return false;
  const firstArgument = (callExpr.arguments ?? [])[0];
  if (!firstArgument) return false;
  return (
    !isNodeOfType(firstArgument, "Literal") &&
    !isNodeOfType(firstArgument, "TemplateLiteral") &&
    !isFunctionLike(firstArgument as EsTreeNode)
  );
};

// Memoizing hooks that WRAP a function they're given — the wrapped function
// is usually a genuine parent prop callback (`useCallback((v) => onChange(v))`,
// `useEventCallback(onChange)`), so their return binding must NOT be exempt.
const FUNCTION_WRAPPER_HOOK_NAMES: ReadonlySet<string> = new Set([
  "useCallback",
  "useMemo",
  "useEvent",
  "useEventCallback",
  "useEffectEvent",
  "useMemoizedFn",
  "useLatest",
  "useStableCallback",
  "useCallbackRef",
]);

const getInitializerCalleeName = (init: EsTreeNode): string | null => {
  if (!isNodeOfType(init, "CallExpression")) return null;
  let callee = init.callee as EsTreeNode;
  // `(useRapidForm as any)({ fieldEvent })` — see through TS cast wrappers
  // so the hook-call check still recognises the callee.
  // ParenthesizedExpression is oxc-only (preserveParens), absent from the
  // TSESTree union, hence the raw type-string check.
  while (
    isNodeOfType(callee, "TSAsExpression") ||
    isNodeOfType(callee, "TSNonNullExpression") ||
    callee.type === ("ParenthesizedExpression" as typeof callee.type)
  ) {
    callee = (callee as unknown as { expression: EsTreeNode }).expression;
  }
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    return callee.property.name;
  }
  return null;
};

// A real parent callback arrives as a function-typed parameter of this
// component / custom hook (or is destructured off the `props` object).
// A setter destructured from a *local state-hook call return* — e.g.
// `const [store, setStore] = useStore(...)` or
// `const { clearHash } = useSessionHashScroll(...)` — owns this
// component's own state, so calling it from an effect is not a
// parent hand-back. Only hook-call initializers qualify, and never the
// function-wrapper hooks: `useCallback` / `useEventCallback` bindings are
// memoized wrappers AROUND a prop callback, the rule's core target.
const resolvesToLocalHookReturnBinding = (
  ref: { resolved?: { defs?: ReadonlyArray<{ node: unknown }> } | null } | null,
): boolean =>
  Boolean(
    ref?.resolved?.defs?.some((def) => {
      const node = def.node as EsTreeNode;
      if (!isNodeOfType(node, "VariableDeclarator") || !node.init) return false;
      const calleeName = getInitializerCalleeName(node.init as EsTreeNode);
      return (
        calleeName !== null &&
        isReactHookName(calleeName) &&
        !FUNCTION_WRAPPER_HOOK_NAMES.has(calleeName)
      );
    }),
  );

const getDirectLocalEffectHelper = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  effectFunction: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const helperFunction = resolveExactLocalFunction(
    callExpression.callee as EsTreeNode,
    context.scopes,
  );
  if (!helperFunction) return null;
  let ancestor = callExpression.parent as EsTreeNode | null | undefined;
  while (ancestor && ancestor !== effectFunction) {
    if (isFunctionLike(ancestor)) return null;
    ancestor = ancestor.parent;
  }
  return ancestor === effectFunction ? helperFunction : null;
};

export const noPassLiveStateToParent = defineRule({
  id: "no-pass-live-state-to-parent",
  title: "Live state pushed to parent via effect",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Move the state up to the parent (or return it from the hook), instead of handing it back up through a prop callback in a useEffect. See https://react.dev/learn/you-might-not-need-an-effect#notifying-parent-components-about-state-changes",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactHookCall(node, "useEffect", context.scopes)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      const effectFnRefs = getEffectFnRefs(analysis, node);
      if (!effectFnRefs) return;
      const effectFn = getEffectFn(analysis, node);
      if (!effectFn) return;
      const effectFunctionBody =
        isNodeOfType(effectFn, "ArrowFunctionExpression") ||
        isNodeOfType(effectFn, "FunctionExpression") ||
        isNodeOfType(effectFn, "FunctionDeclaration")
          ? effectFn.body
          : null;

      for (const ref of effectFnRefs) {
        const callExpr = getCallExpr(ref);
        if (!callExpr || !isNodeOfType(callExpr, "CallExpression")) continue;
        const directLocalEffectHelper = getDirectLocalEffectHelper(callExpr, effectFn, context);
        const callGraphReferences = directLocalEffectHelper
          ? [ref, ...getDownstreamRefs(analysis, directLocalEffectHelper)]
          : [ref];
        const resolvedCallbackPropNames = getParentCallbackPropNames({
          analysis,
          expression: callExpr.callee as EsTreeNode,
          scopes: context.scopes,
        });
        const callExpressionRoot = findTransparentExpressionRoot(callExpr);
        const resolvedCallbackIsNotification = Boolean(
          resolvedCallbackPropNames &&
          callExpr.arguments.length > 0 &&
          (!isCallResultCapturedToLocal(callExpr) ||
            (isNodeOfType(callExpressionRoot.parent, "ReturnStatement") &&
              callExpressionRoot.parent.parent === effectFunctionBody)) &&
          [...resolvedCallbackPropNames].every(
            (callbackPropName) => !DATA_FETCHING_CALLBACK_PATTERN.test(callbackPropName),
          ),
        );
        const notificationCallbackPropNames = resolvedCallbackIsNotification
          ? resolvedCallbackPropNames
          : null;
        if (!notificationCallbackPropNames && hasMutableBindingWrite(ref)) continue;
        // Only a prop reference actually INVOKED as a parent notification
        // somewhere in the call chain counts — a data method called on a
        // destructured prop value (`hrefs.find(...)`) reads the prop and
        // never reaches the parent, a bare completion ping (`onEnd()`)
        // hands nothing up, a locally captured result is a transform read,
        // and a fetch-named callback pulls data in rather than mirroring
        // state up.
        const propCallbackRefs = callGraphReferences.flatMap((callGraphReference) =>
          getEventualCallRefsTo(analysis, callGraphReference, (innerRef) =>
            isParentNotificationCallbackRef(analysis, innerRef),
          ),
        );
        const transparentPropReference =
          propCallbackRefs.length === 0
            ? getTransparentWrapperPropReference(analysis, ref, context)
            : null;
        if (
          propCallbackRefs.length === 0 &&
          !transparentPropReference &&
          !notificationCallbackPropNames
        ) {
          continue;
        }
        if (!notificationCallbackPropNames && resolvesToLocalHookReturnBinding(ref)) continue;
        if (
          !isSynchronous(ref.identifier as unknown as EsTreeNode, effectFn) &&
          !directLocalEffectHelper
        ) {
          continue;
        }
        // When the prop call's result flows into another call's argument
        // (`setDisplay(format(amount))`) the prop is a pure transform
        // consumed locally, not a parent push. Any other position — a bare
        // statement, `onSync && onSync(x)`, a concise arrow body, a promise
        // chain receiver (`load().catch(...)`), an initializer — still hands
        // live state up to the parent.
        if (isCallResultConsumedAsArgument(callExpr)) continue;

        // Skip JS prototype / observer / promise methods — see
        // `no-pass-data-to-parent` for the full rationale — except when
        // a string-read name is called directly ON the props object:
        // `props.search(results)` is a parent callback that happens to
        // be named like `String.prototype.search`.
        const calleeNode = (callExpr as unknown as { callee?: EsTreeNode }).callee;
        const methodName = calleeNode ? getCallMethodName(calleeNode) : null;
        const isPropCallbackNamedLikeStringRead = Boolean(
          methodName &&
          STRING_READ_METHOD_NAMES.has(methodName) &&
          calleeNode &&
          isNodeOfType(calleeNode, "MemberExpression") &&
          stripParenExpression(calleeNode.object) === (ref.identifier as unknown as EsTreeNode) &&
          isWholePropsObjectReference(analysis, ref),
        );
        if (
          methodName &&
          DATA_SINK_METHOD_NAMES.has(methodName) &&
          !isPropCallbackNamedLikeStringRead &&
          !notificationCallbackPropNames
        ) {
          continue;
        }
        if (!notificationCallbackPropNames && calleeNode && isNamespacedApiCallee(calleeNode)) {
          continue;
        }

        const stateArgRefs =
          transparentPropReference || notificationCallbackPropNames
            ? collectDirectCallStateRefs(analysis, callExpr)
            : callGraphReferences.flatMap((callGraphReference) =>
                collectPropCallbackBoundStateRefs(analysis, callGraphReference, (innerRef) =>
                  isParentNotificationCallbackRef(analysis, innerRef),
                ),
              );
        const handsSetterNamedCallbackData = propCallbackRefs.some(
          isSetterNamedCallbackReceivingData,
        );
        if (stateArgRefs.length === 0 && !handsSetterNamedCallbackData) continue;

        context.report({
          node: callExpr,
          message:
            "Pushing state up to a parent from a useEffect costs your users an extra render.",
        });
      }
    },
  }),
});
