import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectEffectStateWriteFacts } from "./utils/collect-effect-state-write-facts.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";

const getStateName = (stateDeclarator: EsTreeNode): string => {
  if (!isNodeOfType(stateDeclarator, "VariableDeclarator")) return "<state>";
  if (!isNodeOfType(stateDeclarator.id, "ArrayPattern")) return "<state>";
  const stateBinding = stateDeclarator.id.elements?.[0] ?? stateDeclarator.id.elements?.[1];
  return stateBinding && isNodeOfType(stateBinding, "Identifier") ? stateBinding.name : "<state>";
};

export const noInitializeState = defineRule({
  id: "no-initialize-state",
  title: "State initialized from a mount effect",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Pass the initial value directly to useState() instead of setting it from a mount-only useEffect. For SSR hydration, prefer useSyncExternalStore().",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactHookCall(node, "useEffect", context.scopes)) return;
      const dependencies = node.arguments?.[1];
      if (
        !dependencies ||
        !isNodeOfType(dependencies, "ArrayExpression") ||
        (dependencies.elements ?? []).length !== 0
      ) {
        return;
      }
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      for (const fact of collectEffectStateWriteFacts(analysis, context, node, context.filename)) {
        if (!fact.isRenderKnownCopy || fact.matchesStateInitializer || fact.resetsSourceState) {
          continue;
        }
        const stateName = getStateName(fact.stateDeclarator);
        context.report({
          node: fact.callExpression,
          message: `Your users see an extra render with empty "${stateName}" because a useEffect sets its starting value.`,
        });
      }
    },
  }),
});
