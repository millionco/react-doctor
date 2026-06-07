import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getArgsUpstreamRefs, getCallExpr, getUpstreamRefs } from "./utils/effect/ast.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  getEffectDepsRefs,
  getEffectFn,
  getEffectFnRefs,
  hasCleanup,
  isState,
  isSyncStateSetterCall,
  isUseEffect,
} from "./utils/effect/react.js";

// 1:1 port of upstream
// `src/rules/no-chain-state-updates.js`.

export const noChainStateUpdates = defineRule<Rule>({
  id: "no-chain-state-updates",
  title: "State updates chained through effects",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Set all the related state together in the event handler that starts it, instead of having one useEffect react to a state change and set more state. See https://react.dev/learn/you-might-not-need-an-effect#chains-of-computations",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isUseEffect(node)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      if (hasCleanup(analysis, node)) return;
      const effectFnRefs = getEffectFnRefs(analysis, node);
      const depsRefs = getEffectDepsRefs(analysis, node);
      if (!effectFnRefs || !depsRefs) return;
      const effectFn = getEffectFn(analysis, node);
      if (!effectFn) return;

      const isSomeDepsState = depsRefs
        .flatMap((ref) => getUpstreamRefs(analysis, ref))
        .some((ref) => isState(analysis, ref));
      if (!isSomeDepsState) return;

      for (const ref of effectFnRefs) {
        if (!isSyncStateSetterCall(analysis, ref, effectFn)) continue;
        const callExpr = getCallExpr(ref);
        if (!callExpr) continue;
        // Avoid overlap with no-derived-state
        const isSomeArgsState = getArgsUpstreamRefs(analysis, ref).some((argRef) =>
          isState(analysis, argRef),
        );
        if (isSomeArgsState) continue;
        context.report({
          node: callExpr,
          message: "Chaining state updates triggers an extra render each step.",
        });
      }
    },
  }),
});
