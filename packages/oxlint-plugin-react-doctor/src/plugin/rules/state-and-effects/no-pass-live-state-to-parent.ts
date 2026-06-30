import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNamespacedApiCallee } from "../../utils/is-namespaced-api-call.js";
import { DATA_SINK_METHOD_NAMES } from "../../constants/data-sink-method-names.js";
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

// A real parent callback arrives as a function-typed parameter of this
// component / custom hook (or is destructured off the `props` object).
// A setter destructured from a *local hook call return* — e.g.
// `const [store, setStore] = useStore(...)` or
// `const { clearHash } = useSessionHashScroll(...)` — owns this
// component's own state, so calling it from an effect is not a
// parent hand-back. Those bindings have a `CallExpression` initializer;
// genuine prop callbacks never do (they're Parameters, or destructures
// of a Parameter / arrow wrappers around one).
const resolvesToLocalHookReturnBinding = (
  ref: { resolved?: { defs?: ReadonlyArray<{ node: unknown }> } | null } | null,
): boolean =>
  Boolean(
    ref?.resolved?.defs?.some((def) => {
      const node = def.node as EsTreeNode;
      return isNodeOfType(node, "VariableDeclarator") && isNodeOfType(node.init, "CallExpression");
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
