import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getMotionReactApiPath } from "../../utils/get-motion-react-api-path.js";
import { isInsideStableReactInitializer } from "../../utils/is-inside-stable-react-initializer.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const motionCreateInRender = defineRule({
  id: "motion-create-in-render",
  title: "Motion component is created during render",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Create Motion components at module scope, or memoize a genuinely dynamic component factory so its identity remains stable.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (getMotionReactApiPath(node.callee, context.scopes) !== "motion.create") return;
      if (!findRenderPhaseComponentOrHook(node, context.scopes)) return;
      if (isInsideStableReactInitializer(node, context.scopes)) return;
      context.report({
        node,
        message:
          "motion.create() builds a new component type during this render, which resets identity and can break animation continuity. Hoist it or memoize the factory.",
      });
    },
  }),
});
