import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  getArgsUpstreamRefs,
  getCallExpr,
  getUpstreamRefs,
  isSynchronous,
} from "./utils/effect/ast.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  getEffectDepsRefs,
  getEffectFn,
  getEffectFnRefs,
  isProp,
  isStateSetterCall,
  isUseEffect,
} from "./utils/effect/react.js";

// Detector logic is a port of upstream `src/rules/no-adjust-state-on-prop-change.js`
// (severity and message intentionally diverge — see SOURCE.md).
// Note: upstream does NOT skip on cleanup return.

export const noAdjustStateOnPropChange = defineRule<Rule>({
  id: "no-adjust-state-on-prop-change",
  severity: "error",
  tags: ["test-noise"],
  recommendation:
    "Adjust the state inline during render with a `prev`-prop comparison (`if (prop !== prevProp) { setPrevProp(prop); setX(...); }`), or refactor to remove the duplicated state. Routing the adjustment through a useEffect forces an extra render with a stale UI between the two commits. See https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isUseEffect(node)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      const effectFnRefs = getEffectFnRefs(analysis, node);
      const depsRefs = getEffectDepsRefs(analysis, node);
      if (!effectFnRefs || !depsRefs) return;
      const effectFn = getEffectFn(analysis, node);
      if (!effectFn) return;

      const isSomeDepsProps = depsRefs
        .flatMap((ref) => getUpstreamRefs(analysis, ref))
        .some((ref) => isProp(analysis, ref));
      if (!isSomeDepsProps) return;

      for (const ref of effectFnRefs) {
        if (!isStateSetterCall(analysis, ref)) continue;
        if (!isSynchronous(ref.identifier as unknown as EsTreeNode, effectFn)) continue;
        const callExpr = getCallExpr(ref);
        if (!callExpr) continue;
        // Avoid overlap with no-derived-state
        const isSomeArgsProps = getArgsUpstreamRefs(analysis, ref).some((argRef) =>
          isProp(analysis, argRef),
        );
        if (isSomeArgsProps) continue;
        context.report({
          node: callExpr,
          message:
            "State adjusted in a useEffect when a prop changes — forces an extra render with a stale UI between the two commits. Adjust the state during render with a `prev`-prop comparison instead, or refactor to remove the duplicated state.",
        });
      }
    },
  }),
});
