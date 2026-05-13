import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

// HACK: in React's <ViewTransition> world, calling
// `document.startViewTransition()` directly bypasses React's lifecycle
// hooks and can fight the auto-generated `viewTransitionName`s React
// emits. The supported way is to render <ViewTransition> and let React
// call startViewTransition for you (around startTransition, useDeferredValue,
// or Suspense reveals).
export const noDocumentStartViewTransition = defineRule<Rule>({
  recommendation:
    "Render a <ViewTransition> component and update inside startTransition / useDeferredValue — React calls startViewTransition for you",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      const callee = node.callee;
      if (callee?.type !== "MemberExpression") return;
      if (callee.object?.type !== "Identifier" || callee.object.name !== "document") return;
      if (callee.property?.type !== "Identifier" || callee.property.name !== "startViewTransition")
        return;
      context.report({
        node,
        message:
          "document.startViewTransition() bypasses React's <ViewTransition> integration — render a <ViewTransition> component and let React drive the transition (around startTransition / useDeferredValue / Suspense)",
      });
    },
  }),
});
