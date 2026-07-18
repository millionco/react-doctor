import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenBrowserApiReceiver } from "../../utils/is-proven-browser-api-receiver.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const waapiAnimationInRender = defineRule({
  id: "waapi-animation-in-render",
  title: "Web Animation starts during render",
  severity: "error",
  category: "Correctness",
  recommendation:
    "Start element.animate() from an effect or interaction handler so React renders stay pure.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (getStaticPropertyName(node.callee) !== "animate") return;
      if (
        !isProvenBrowserApiReceiver(node.callee.object, "dom-event-target", context.scopes) ||
        !findRenderPhaseComponentOrHook(node, context.scopes)
      ) {
        return;
      }
      context.report({
        node,
        message:
          "This Web Animation starts during render, so React retries and re-renders can replay it. Move element.animate() to an effect or interaction handler.",
      });
    },
  }),
});
