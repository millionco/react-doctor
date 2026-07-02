import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNamespacedApiCallee } from "../../utils/is-namespaced-api-call.js";
import { isCallResultConsumedAsArgument } from "../../utils/is-call-result-consumed-as-argument.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import {
  DATA_SINK_METHOD_NAMES,
  STRING_READ_METHOD_NAMES,
} from "../../constants/data-sink-method-names.js";
import { getCallMethodName } from "../../utils/get-call-method-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getArgsUpstreamRefs, getCallExpr, isSynchronous } from "./utils/effect/ast.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  getEffectFn,
  getEffectFnRefs,
  isPropCall,
  isState,
  isUseEffect,
  isWholePropsObjectReference,
} from "./utils/effect/react.js";

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
  const callee = init.callee;
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

export const noPassLiveStateToParent = defineRule({
  id: "no-pass-live-state-to-parent",
  title: "Live state pushed to parent via effect",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Move the state up to the parent (or return it from the hook), instead of handing it back up through a prop callback in a useEffect. See https://react.dev/learn/you-might-not-need-an-effect#notifying-parent-components-about-state-changes",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isUseEffect(node)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      const effectFnRefs = getEffectFnRefs(analysis, node);
      if (!effectFnRefs) return;
      const effectFn = getEffectFn(analysis, node);
      if (!effectFn) return;

      for (const ref of effectFnRefs) {
        if (!isPropCall(analysis, ref)) continue;
        if (resolvesToLocalHookReturnBinding(ref)) continue;
        if (!isSynchronous(ref.identifier as unknown as EsTreeNode, effectFn)) continue;
        const callExpr = getCallExpr(ref);
        if (!callExpr) continue;
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
          calleeNode.object === (ref.identifier as unknown as typeof calleeNode.object) &&
          isWholePropsObjectReference(analysis, ref),
        );
        if (
          methodName &&
          DATA_SINK_METHOD_NAMES.has(methodName) &&
          !isPropCallbackNamedLikeStringRead
        ) {
          continue;
        }
        if (calleeNode && isNamespacedApiCallee(calleeNode)) continue;

        const stateArgRefs = getArgsUpstreamRefs(analysis, ref).filter((argRef) =>
          isState(analysis, argRef),
        );
        if (stateArgRefs.length === 0) continue;

        context.report({
          node: callExpr,
          message:
            "Pushing state up to a parent from a useEffect costs your users an extra render.",
        });
      }
    },
  }),
});
