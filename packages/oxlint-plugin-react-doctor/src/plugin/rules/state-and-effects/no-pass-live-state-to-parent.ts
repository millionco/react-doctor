import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNamespacedApiCallee } from "../../utils/is-namespaced-api-call.js";
import { DATA_SINK_METHOD_NAMES } from "../../constants/data-sink-method-names.js";
import { getCallMethodName } from "../../utils/get-call-method-name.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getArgsUpstreamRefs, getCallExpr, isSynchronous } from "./utils/effect/ast.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  getEffectFn,
  getEffectFnRefs,
  isPropCall,
  isState,
  isUseEffect,
} from "./utils/effect/react.js";

export const noPassLiveStateToParent = defineRule<Rule>({
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
        if (!isSynchronous(ref.identifier as unknown as EsTreeNode, effectFn)) continue;
        const callExpr = getCallExpr(ref);
        if (!callExpr) continue;

        // Skip JS prototype / observer / promise methods — see
        // `no-pass-data-to-parent` for the full rationale.
        const calleeNode = (callExpr as unknown as { callee?: EsTreeNode }).callee;
        const methodName = calleeNode ? getCallMethodName(calleeNode) : null;
        if (methodName && DATA_SINK_METHOD_NAMES.has(methodName)) continue;
        if (calleeNode && isNamespacedApiCallee(calleeNode)) continue;

        const isStateInArgs = getArgsUpstreamRefs(analysis, ref).some((argRef) =>
          isState(analysis, argRef),
        );
        if (!isStateInArgs) continue;

        context.report({
          node: callExpr,
          message:
            "Pushing state up to a parent from a useEffect costs your users an extra render.",
        });
      }
    },
  }),
});
