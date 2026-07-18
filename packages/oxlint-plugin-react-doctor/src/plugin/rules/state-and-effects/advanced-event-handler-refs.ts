import { EFFECT_HOOK_NAMES, SUBSCRIPTION_METHOD_NAMES } from "../../constants/react.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// Hooks whose return value carries a stable identity across renders, so a
// handler bound to one never forces the listener to re-subscribe. Includes
// the common userland stable-callback hooks (rc-util/ahooks `useEvent`,
// MUI `useEventCallback`, ahooks `useMemoizedFn`, `useStableCallback`) —
// they ARE the ref-based pattern this rule recommends.
const REACT_STABLE_HANDLER_HOOK_NAMES = new Set(["useCallback", "useEffectEvent"]);
const CUSTOM_STABLE_HANDLER_HOOK_NAMES = new Set([
  "useEffectEvent",
  "useEvent",
  "useEventCallback",
  "useMemoizedFn",
  "useStableCallback",
]);

// `useThrottleCallback` / `useThrottledCallback` / `useDebouncedCallback`
// wrappers memoize internally: identity only changes when their explicit
// deps change (rare and intentional), so the per-render re-subscription
// churn the rule targets doesn't exist. The ref-wrapper refactor would
// also break the `.cancel()`/`.flush()` cleanup these wrappers require
// (docs-validation r2: tracecat use-window-size, cloudscape
// collapsible-flashbar).
const THROTTLED_HANDLER_HOOK_PATTERN = /^use\w*(?:Throttle|Debounce)/i;

const isThrottledHandlerHookCall = (callNode: EsTreeNodeOfType<"CallExpression">): boolean => {
  const calleeName = getCalleeName(callNode);
  return calleeName !== null && THROTTLED_HANDLER_HOOK_PATTERN.test(calleeName);
};

const isEmptyDepsUseMemoCall = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isReactHookCall(callNode, "useMemo", scopes)) return false;
  const memoDepsNode = callNode.arguments?.[1];
  return (
    isNodeOfType(memoDepsNode, "ArrayExpression") && (memoDepsNode.elements?.length ?? 0) === 0
  );
};

// `const handler = useCallback(...)` / `useEvent(...)` / `useMemo(fn, [])` /
// `someRef.current` (a `useRef(...).current` read) all keep a stable
// identity, so listing the handler in the deps does NOT cause real
// re-subscription churn. `useMemo` with non-empty deps still churns.
const isStableHandlerInitializer = (initializer: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isNodeOfType(initializer, "CallExpression")) {
    return (
      isReactHookCall(initializer, REACT_STABLE_HANDLER_HOOK_NAMES, scopes) ||
      isHookCall(initializer, CUSTOM_STABLE_HANDLER_HOOK_NAMES) ||
      isEmptyDepsUseMemoCall(initializer, scopes) ||
      isThrottledHandlerHookCall(initializer)
    );
  }
  return (
    isNodeOfType(initializer, "MemberExpression") &&
    isNodeOfType(initializer.property, "Identifier") &&
    initializer.property.name === "current"
  );
};

// A subscription receiver backed by `useRef(...)` has a stable identity, so
// its presence in the deps never forces re-subscription on its own — the
// handler churn is still the only churn.
const isStableRefReceiverDep = (
  referenceNode: EsTreeNode,
  receiverDepName: string,
  scopes: ScopeAnalysis,
): boolean => {
  const receiverBinding = findVariableInitializer(referenceNode, receiverDepName);
  return Boolean(
    receiverBinding?.initializer && isReactHookCall(receiverBinding.initializer, "useRef", scopes),
  );
};

// HACK: `useEffect(() => { window.addEventListener(name, handler);
// return () => window.removeEventListener(name, handler); }, [handler])`
// is the canonical "I want the latest handler" anti-pattern: every time
// the parent re-renders with a new `handler` prop, the effect tears
// down and re-subscribes. This thrashes the listener for no reason —
// the subscription itself doesn't change, only the function it points
// to. Store the handler in a ref (`handlerRef.current = handler` in a
// separate effect or a layout effect) and have the registered listener
// read `handlerRef.current()`, then take `handler` out of the deps.
//
// Heuristic: useEffect whose dep array contains an identifier (must be
// a function-typed prop or local in practice — we approximate by
// requiring it to also appear as the second argument to
// `addEventListener`/`subscribe`-shaped calls inside the effect body).
// The shared `SUBSCRIPTION_METHOD_NAMES` set comes from `constants.ts`
// so this rule and `prefer-use-sync-external-store` agree on what
// counts as a subscription-shaped call (zustand/Redux `subscribe`,
// browser `addEventListener`, EventEmitter `on`, etc.).
export const advancedEventHandlerRefs = defineRule({
  id: "advanced-event-handler-refs",
  title: "Listener re-subscribes on every handler change",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Store the handler in a ref and have the listener read `handlerRef.current()`. The subscription stays put while the latest handler still runs.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactHookCall(node, EFFECT_HOOK_NAMES, context.scopes)) return;
      if ((node.arguments?.length ?? 0) < 2) return;
      const callback = getEffectCallback(node);
      if (
        !callback ||
        (!isNodeOfType(callback, "ArrowFunctionExpression") &&
          !isNodeOfType(callback, "FunctionExpression"))
      )
        return;
      const depsNode = node.arguments[1];
      if (!isNodeOfType(depsNode, "ArrayExpression") || !depsNode.elements?.length) return;

      const depIdentifierNames = new Set<string>();
      for (const element of depsNode.elements) {
        if (isNodeOfType(element, "Identifier")) depIdentifierNames.add(element.name);
      }
      if (depIdentifierNames.size === 0) return;

      // Look for an addEventListener (etc.) call inside the body whose
      // second argument is one of our deps. Also collect the receiver root
      // (`socket` in `socket.on(...)`) of every subscription call so we can
      // tell when re-subscription is forced by a non-handler dep.
      let registeredHandlerName: string | null = null;
      const subscriptionReceiverNames = new Set<string>();
      walkAst(callback.body, (child: EsTreeNode) => {
        if (!isNodeOfType(child, "CallExpression")) return;
        if (!isNodeOfType(child.callee, "MemberExpression")) return;
        if (!isNodeOfType(child.callee.property, "Identifier")) return;
        if (!SUBSCRIPTION_METHOD_NAMES.has(child.callee.property.name)) return;
        const receiverName = getRootIdentifierName(child.callee.object);
        if (receiverName) subscriptionReceiverNames.add(receiverName);
        const handlerArg = child.arguments?.[1];
        if (!isNodeOfType(handlerArg, "Identifier")) return;
        if (!registeredHandlerName && depIdentifierNames.has(handlerArg.name)) {
          registeredHandlerName = handlerArg.name;
        }
      });

      if (!registeredHandlerName) return;

      // The handler has a stable identity (useCallback / useEvent /
      // useMemo with [] deps / a `ref.current` read), so listing it in
      // the deps never actually churns the subscription. Scope-aware
      // lookup: a prop param shadowing an outer stable binding resolves
      // to the (unstable) param, not the outer const.
      const handlerBinding = findVariableInitializer(node, registeredHandlerName);
      if (
        handlerBinding?.initializer &&
        isStableHandlerInitializer(handlerBinding.initializer, context.scopes)
      ) {
        return;
      }

      // Another dep is itself the subscription target (`socket` in
      // `[onMessage, socket]` driving `socket.on(...)`). The listener must
      // re-subscribe when that target changes regardless of the handler, so
      // moving the handler into a ref wouldn't remove the re-subscription.
      // A `useRef(...)` receiver is exempt from this bailout: its identity
      // never changes, so the handler churn is still the only churn.
      const hasNonHandlerDepTarget = [...depIdentifierNames].some(
        (depName) =>
          depName !== registeredHandlerName &&
          subscriptionReceiverNames.has(depName) &&
          !isStableRefReceiverDep(node, depName, context.scopes),
      );
      if (hasNonHandlerDepTarget) return;

      context.report({
        node,
        message: `useEffect re-adds the "${registeredHandlerName}" listener every time the handler changes.`,
      });
    },
  }),
});
