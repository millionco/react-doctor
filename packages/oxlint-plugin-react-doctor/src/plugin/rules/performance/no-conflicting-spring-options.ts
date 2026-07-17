import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getConflictingMotionSpringDurationProperty } from "../../utils/get-conflicting-motion-spring-duration-property.js";
import { getStaticMotionTransitionObjects } from "../../utils/get-static-motion-transition-objects.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const noConflictingSpringOptions = defineRule({
  id: "no-conflicting-spring-options",
  title: "Motion spring mixes incompatible option modes",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Choose either stiffness/damping/mass or duration/bounce for a Motion spring so every configured value takes effect.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      for (const transitionObject of getStaticMotionTransitionObjects(node, context.scopes)) {
        const durationProperty = getConflictingMotionSpringDurationProperty(
          transitionObject.properties,
        );
        if (!durationProperty || !isNodeOfType(durationProperty, "Property")) {
          continue;
        }

        context.report({
          node: durationProperty,
          message:
            "This spring mixes physics controls with duration-based controls, so Motion ignores duration and bounce. Keep only one spring configuration mode.",
        });
      }
    },
  }),
});
