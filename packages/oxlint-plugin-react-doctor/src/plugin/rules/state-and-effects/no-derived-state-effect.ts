import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectEffectStateWriteFacts } from "./utils/collect-effect-state-write-facts.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";

export const noDerivedStateEffect = defineRule({
  id: "no-derived-state-effect",
  title: "Derived state stored in an effect",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Work out derived values while rendering: `const x = fn(dep)`. To reset a component's state when a prop changes, give it a key prop: `<Component key={prop} />`. See https://react.dev/learn/you-might-not-need-an-effect",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactHookCall(node, EFFECT_HOOK_NAMES, context.scopes)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      const derivedWrite = collectEffectStateWriteFacts(
        analysis,
        context,
        node,
        context.filename,
      ).find((fact) => fact.isRenderKnownCopy && !fact.resetsSourceState);
      if (!derivedWrite) return;
      context.report({
        node,
        message: "You pay an extra render for state you can derive from other values.",
      });
    },
  }),
});
