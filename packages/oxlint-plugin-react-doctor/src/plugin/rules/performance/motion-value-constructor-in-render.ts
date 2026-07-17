import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getMotionReactApiPath } from "../../utils/get-motion-react-api-path.js";
import { isInsideStableReactInitializer } from "../../utils/is-inside-stable-react-initializer.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const motionValueConstructorInRender = defineRule({
  id: "motion-value-constructor-in-render",
  title: "Motion value is recreated during render",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Use useMotionValue inside React components, or create a manual motionValue outside the render path.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (getMotionReactApiPath(node.callee, context.scopes) !== "motionValue") return;
      if (!findRenderPhaseComponentOrHook(node, context.scopes)) return;
      if (isInsideStableReactInitializer(node, context.scopes)) return;
      context.report({
        node,
        message:
          "motionValue() creates a fresh reactive object during this render. Use useMotionValue() so React preserves the value across renders.",
      });
    },
  }),
});
