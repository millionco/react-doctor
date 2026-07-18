import { defineRule } from "../../utils/define-rule.js";
import { createComponentPropStackTracker } from "../../utils/create-component-prop-stack-tracker.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectEffectStateWriteFacts } from "./utils/collect-effect-state-write-facts.js";
import { collectRenderStateWriteFacts } from "./utils/collect-render-state-write-facts.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";

const getStateName = (stateDeclarator: EsTreeNode): string => {
  if (!isNodeOfType(stateDeclarator, "VariableDeclarator")) return "<state>";
  if (!isNodeOfType(stateDeclarator.id, "ArrayPattern")) return "<state>";
  const stateBinding = stateDeclarator.id.elements?.[0];
  if (stateBinding && isNodeOfType(stateBinding, "Identifier")) return stateBinding.name;
  const setterBinding = stateDeclarator.id.elements?.[1];
  if (!setterBinding || !isNodeOfType(setterBinding, "Identifier")) return "<state>";
  if (!setterBinding.name.startsWith("set") || setterBinding.name.length <= 3) {
    return setterBinding.name;
  }
  return setterBinding.name[3].toLowerCase() + setterBinding.name.slice(4);
};

export const noDerivedState = defineRule({
  id: "no-derived-state",
  title: "Derived value copied into state",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Work out the value while rendering (or with useMemo if it's expensive) instead of copying it into state and synchronizing it during render or through an effect. See https://react.dev/learn/you-might-not-need-an-effect#updating-state-based-on-props-or-state",
  create: (context: RuleContext) => {
    const reportStateWrite = (callExpression: EsTreeNode, stateDeclarator: EsTreeNode): void => {
      const stateName = getStateName(stateDeclarator);
      context.report({
        node: callExpression,
        message: `Storing "${stateName}" in state when you can derive it from other values costs an extra render.`,
      });
    };
    const componentTracker = createComponentPropStackTracker({
      onComponentEnter: (componentBody) => {
        if (!componentBody) return;
        const analysis = getProgramAnalysis(componentBody);
        if (!analysis) return;
        for (const fact of collectRenderStateWriteFacts(
          analysis,
          componentBody,
          context.filename,
        )) {
          reportStateWrite(fact.callExpression, fact.stateDeclarator);
        }
      },
    });
    return {
      ...componentTracker.visitors,
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isReactHookCall(node, "useEffect", context.scopes)) return;
        const analysis = getProgramAnalysis(node);
        if (!analysis) return;
        for (const fact of collectEffectStateWriteFacts(
          analysis,
          context,
          node,
          context.filename,
        )) {
          if (!fact.isRenderKnownCopy || fact.resetsSourceState) continue;
          reportStateWrite(fact.callExpression, fact.stateDeclarator);
        }
      },
    };
  },
});
