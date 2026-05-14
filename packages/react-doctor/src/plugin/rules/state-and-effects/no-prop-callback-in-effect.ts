import { EFFECT_HOOK_NAMES } from "../../constants.js";
import { createComponentPropStackTracker } from "../../utils/create-component-prop-stack-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { walkInsideStatementBlocks } from "../../utils/walk-inside-statement-blocks.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

// HACK: `useEffect(() => parentCallback(state.x), [state.x])` is the
// "lift state up via callback" anti-pattern: the child owns state, then
// fires a parent callback every time the state changes to keep the
// parent in sync. The parent has no real ground-truth state, just a
// stale mirror. The right shape is to lift state into a Provider that
// both child and parent read from; the child then doesn't need an
// effect-driven sync at all.
export const noPropCallbackInEffect = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "State & Effects",
  recommendation:
    "Lift the shared state into a Provider so both sides read the same source — no useEffect-driven sync needed",
  create: (context: RuleContext) => {
    const propStackTracker = createComponentPropStackTracker();

    return {
      ...propStackTracker.visitors,
      CallExpression(node: EsTreeNode) {
        if (!isHookCall(node, EFFECT_HOOK_NAMES) || (node.arguments?.length ?? 0) < 2) return;
        const callback = getEffectCallback(node);
        if (!callback) return;
        const depsNode = node.arguments[1];
        if (!isNodeOfType(depsNode, "ArrayExpression") || !depsNode.elements?.length) return;

        // Only flag if at least one dep is a non-prop (state-shape)
        // identifier — otherwise the effect is just adapting to prop
        // changes (legit pattern).
        const hasStateLikeDep = (depsNode.elements ?? []).some(
          (element) =>
            isNodeOfType(element, "Identifier") && !propStackTracker.isPropName(element.name),
        );
        if (!hasStateLikeDep) return;

        // HACK: walk control-flow descendants (`if`, `try`, `for`,
        // `switch`) but stop at any nested function boundary so calls
        // inside `setTimeout(() => onChange(state))` aren't conflated
        // with the top-level `onChange(state)` shape — those belong to
        // `prefer-use-effect-event` (sub-handler reads), not this rule
        // (lift state via callback).
        const reportedNodes = new Set<EsTreeNode>();
        walkInsideStatementBlocks(callback.body, (child: EsTreeNode) => {
          if (!isNodeOfType(child, "CallExpression")) return;
          if (!isNodeOfType(child.callee, "Identifier")) return;
          const calleeName = child.callee.name;
          if (!propStackTracker.isPropName(calleeName)) return;
          if (reportedNodes.has(child)) return;
          reportedNodes.add(child);
          context.report({
            node: child,
            message: `useEffect calls prop callback "${calleeName}" with local state in deps — this is the "lift state via callback" anti-pattern; lift state into a shared Provider so both sides read the same source`,
          });
        });
      },
    };
  },
});
