import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
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
import { isRenderKnownSelectionRepair } from "./utils/is-render-known-selection-repair.js";

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

const hasRenderTrackerGuardShape = (componentBody: EsTreeNode): boolean => {
  if (!isNodeOfType(componentBody, "BlockStatement")) return false;
  for (const statement of componentBody.body ?? []) {
    if (
      isNodeOfType(statement, "IfStatement") &&
      !statement.alternate &&
      isNodeOfType(statement.test, "BinaryExpression") &&
      statement.test.operator === "!==" &&
      isNodeOfType(statement.consequent, "BlockStatement")
    ) {
      return true;
    }
  }
  return false;
};

export const noDerivedState = defineRule({
  id: "no-derived-state",
  title: "Derived value copied into state",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Calculate the value during render if the state only mirrors its inputs. If the state can change independently, keep it and make its reset conditions explicit. See https://react.dev/learn/you-might-not-need-an-effect#updating-state-based-on-props-or-state",
  create: (context: RuleContext) => {
    const reportStateWrite = (
      callExpression: EsTreeNode,
      stateDeclarator: EsTreeNode,
      phase: "effect" | "render",
    ): void => {
      const stateName = getStateName(stateDeclarator);
      context.report({
        node: callExpression,
        message: `"${stateName}" receives a value copied ${phase === "effect" ? "from an effect" : "during render"}.`,
      });
    };
    const componentTracker = createComponentPropStackTracker({
      onComponentEnter: (componentBody) => {
        if (!componentBody || !hasRenderTrackerGuardShape(componentBody)) return;
        const analysis = getProgramAnalysis(componentBody);
        if (!analysis) return;
        for (const fact of collectRenderStateWriteFacts(
          analysis,
          componentBody,
          context.filename,
        )) {
          reportStateWrite(fact.callExpression, fact.stateDeclarator, "render");
        }
      },
    });
    return {
      ...componentTracker.visitors,
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isReactHookCall(node, EFFECT_HOOK_NAMES, context.scopes)) return;
        const analysis = getProgramAnalysis(node);
        if (!analysis) return;
        for (const fact of collectEffectStateWriteFacts(
          analysis,
          context,
          node,
          context.filename,
        )) {
          if (
            (!fact.isRenderKnownCopy || fact.resetsSourceState) &&
            !isRenderKnownSelectionRepair(analysis, node, fact)
          ) {
            continue;
          }
          reportStateWrite(fact.callExpression, fact.stateDeclarator, "effect");
        }
      },
    };
  },
});
