import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

// HACK: in React's <ViewTransition> world, calling
// `document.startViewTransition()` directly bypasses React's lifecycle
// hooks and can fight the auto-generated `viewTransitionName`s React
// emits. The supported way is to render <ViewTransition> and let React
// call startViewTransition for you (around startTransition, useDeferredValue,
// or Suspense reveals).
export const noDocumentStartViewTransition = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Render a <ViewTransition> component and update inside startTransition / useDeferredValue — React calls startViewTransition for you",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      const callee = node.callee;
      if (!isNodeOfType(callee, "MemberExpression")) return;
      if (!isNodeOfType(callee.object, "Identifier") || callee.object.name !== "document") return;
      if (
        !isNodeOfType(callee.property, "Identifier") ||
        callee.property.name !== "startViewTransition"
      )
        return;
      context.report({
        node,
        message:
          "document.startViewTransition() bypasses React's <ViewTransition> integration — render a <ViewTransition> component and let React drive the transition (around startTransition / useDeferredValue / Suspense)",
      });
    },
  }),
});
