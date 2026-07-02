import type { Reference } from "eslint-scope";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNamespacedApiCallee } from "../../utils/is-namespaced-api-call.js";
import { isCallResultConsumedAsArgument } from "../../utils/is-call-result-consumed-as-argument.js";
import { DATA_SINK_METHOD_NAMES } from "../../constants/data-sink-method-names.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getCallMethodName } from "../../utils/get-call-method-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getArgsUpstreamRefs, getCallExpr, isSynchronous } from "./utils/effect/ast.js";
import { isExternallyDrivenState } from "./utils/effect/external-state.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  getEffectFn,
  getEffectFnRefs,
  isPropCall,
  isState,
  isUseEffect,
} from "./utils/effect/react.js";

const HOOK_CALLEE_NAME_PATTERN = /^use[A-Z0-9]/;

// Hooks that return (a memoized identity for) the very function they are
// given. `const notify = useCallback((v) => onChange(v), [onChange])` is
// still the parent's callback, just wrapped — calling it from an effect IS
// the parent hand-back this rule targets.
const MEMOIZING_WRAPPER_HOOK_NAMES: ReadonlySet<string> = new Set(["useCallback", "useMemo"]);

// A function destructured from a *state-owning hook call return* — e.g.
// `const [store, setStore] = useStore(...)` or
// `const { clearHash } = useSessionHashScroll(...)` — operates on this
// component's own state, so calling it from an effect is not a parent
// hand-back even when the hook was seeded from props. Memoizing wrappers
// (`useCallback` / `useMemo`) are excluded: they return the caller's own
// function, so the binding is still whatever it wraps — often a genuine
// prop callback.
const resolvesToLocalHookReturnBinding = (ref: Reference): boolean =>
  Boolean(
    ref.resolved?.defs.some((def) => {
      const node = def.node as unknown as EsTreeNode;
      if (!isNodeOfType(node, "VariableDeclarator") || !isNodeOfType(node.init, "CallExpression")) {
        return false;
      }
      const calleeName = getCalleeName(node.init);
      return (
        calleeName !== null &&
        HOOK_CALLEE_NAME_PATTERN.test(calleeName) &&
        !MEMOIZING_WRAPPER_HOOK_NAMES.has(calleeName)
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
        // statement, `onSync && onSync(x)`, a concise arrow body, an
        // initializer — still hands live state up to the parent.
        if (isCallResultConsumedAsArgument(callExpr)) continue;

        // Skip JS prototype / observer / promise methods — see
        // `no-pass-data-to-parent` for the full rationale.
        const calleeNode = (callExpr as unknown as { callee?: EsTreeNode }).callee;
        const methodName = calleeNode ? getCallMethodName(calleeNode) : null;
        if (methodName && DATA_SINK_METHOD_NAMES.has(methodName)) continue;
        if (calleeNode && isNamespacedApiCallee(calleeNode)) continue;

        const stateArgRefs = getArgsUpstreamRefs(analysis, ref).filter((argRef) =>
          isState(analysis, argRef),
        );
        if (stateArgRefs.length === 0) continue;
        // The state handed to the parent is driven by a timer / listener /
        // observer / subscription — the child genuinely owns this
        // externally-sourced value, so "lift it to the parent" doesn't apply.
        if (stateArgRefs.every((argRef) => isExternallyDrivenState(analysis, argRef))) continue;

        context.report({
          node: callExpr,
          message:
            "Pushing state up to a parent from a useEffect costs your users an extra render.",
        });
      }
    },
  }),
});
