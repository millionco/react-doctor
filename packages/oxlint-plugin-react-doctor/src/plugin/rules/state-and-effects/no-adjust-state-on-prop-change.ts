import { defineRule } from "../../utils/define-rule.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectEffectStateWriteFacts } from "./utils/collect-effect-state-write-facts.js";
import { getUpstreamRefs } from "./utils/effect/ast.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { getEffectDepsRefs, hasCleanup, isProp, isState } from "./utils/effect/react.js";
import { hasDeferredOrExternalEffectWork } from "./utils/has-deferred-or-external-effect-work.js";

export const noAdjustStateOnPropChange = defineRule({
  id: "no-adjust-state-on-prop-change",
  title: "State adjusted after a prop changes",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Remove the adjustment effect by deriving values during render, resetting the component with a key, or updating related state in the event that changes the prop. Avoid tracking the previous prop in more state, which preserves the duplication. See https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactHookCall(node, "useEffect", context.scopes)) return;
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
      const facts = collectEffectStateWriteFacts(analysis, context, node, context.filename);
      if (
        hasCleanup(analysis, node) ||
        hasDeferredOrExternalEffectWork(analysis, node, context.scopes) ||
        facts.some((fact) => fact.isDeferred)
      ) {
        return;
      }
      for (const fact of facts) {
        if (!fact.isSynchronousRenderValue || fact.resetsSourceState) continue;
        const writtenValueHasPropSource = fact.sourceReferences
          .flatMap((reference) => getUpstreamRefs(analysis, reference))
          .some((reference) => isProp(analysis, reference));
        if (writtenValueHasPropSource) continue;
        context.report({
          node: fact.callExpression,
          message:
            "This effect adjusts state after a prop changes, so users briefly see the stale value.",
        });
      }
    },
  }),
});
