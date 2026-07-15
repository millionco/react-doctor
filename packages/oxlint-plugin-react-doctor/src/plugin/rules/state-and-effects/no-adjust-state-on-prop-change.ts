import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectEffectStateWriteFacts } from "./utils/collect-effect-state-write-facts.js";
import { getUpstreamRefs } from "./utils/effect/ast.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { getEffectDepsRefs, isProp, isState, isUseEffect } from "./utils/effect/react.js";

export const noAdjustStateOnPropChange = defineRule({
  id: "no-adjust-state-on-prop-change",
  title: "State synced to a prop inside an effect",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Adjust the state inline during render with a `prev`-prop comparison (`if (prop !== prevProp) { setPrevProp(prop); setX(...); }`), or refactor to remove the duplicated state. Routing the adjustment through a useEffect forces an extra render with a stale UI between the two commits. See https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isUseEffect(node)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      const dependencyReferences = getEffectDepsRefs(analysis, node);
      if (!dependencyReferences) return;
      const hasPropDependency = dependencyReferences
        .flatMap((reference) =>
          isState(analysis, reference) ? [] : getUpstreamRefs(analysis, reference),
        )
        .some((reference) => isProp(analysis, reference));
      if (!hasPropDependency) return;
      for (const fact of collectEffectStateWriteFacts(analysis, context, node, context.filename)) {
        if (!fact.isRenderKnownCopy || fact.resetsSourceState) continue;
        context.report({
          node: fact.callExpression,
          message:
            "This effect adjusts state after a prop changes, so users briefly see the stale value.",
        });
      }
    },
  }),
});
