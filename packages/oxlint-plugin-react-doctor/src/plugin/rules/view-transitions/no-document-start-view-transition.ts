import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";

const REACT_VIEW_TRANSITION_EXPORT_NAMES = ["ViewTransition", "unstable_ViewTransition"];

// Only files that opt into React's experimental <ViewTransition> can have
// their animation lifecycle bypassed. A plain `document.startViewTransition`
// call in a codebase that never imports it is legitimate direct use of the
// browser View Transitions API.
const importsReactViewTransition = (contextNode: EsTreeNode): boolean =>
  REACT_VIEW_TRANSITION_EXPORT_NAMES.some((localName) => {
    const binding = getImportBindingForName(contextNode, localName);
    return (
      binding !== null &&
      binding.source === "react" &&
      binding.exportedName !== null &&
      REACT_VIEW_TRANSITION_EXPORT_NAMES.includes(binding.exportedName)
    );
  });

// HACK: in React's <ViewTransition> world, calling
// `document.startViewTransition()` directly bypasses React's lifecycle
// hooks and can fight the auto-generated `viewTransitionName`s React
// emits. The supported way is to render <ViewTransition> and let React
// call startViewTransition for you (around startTransition, useDeferredValue,
// or Suspense reveals).
export const noDocumentStartViewTransition = defineRule({
  id: "no-document-start-view-transition",
  title: "Direct document.startViewTransition call",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Render a <ViewTransition> component and update inside startTransition or useDeferredValue, and React calls startViewTransition for you.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = node.callee;
      if (!isNodeOfType(callee, "MemberExpression")) return;
      if (!isNodeOfType(callee.object, "Identifier") || callee.object.name !== "document") return;
      if (
        !isNodeOfType(callee.property, "Identifier") ||
        callee.property.name !== "startViewTransition"
      )
        return;
      // A locally-bound `document` (e.g. a function parameter) shadows the
      // global, so its `startViewTransition` is unrelated to the DOM API.
      if (context.scopes.symbolFor(callee.object) !== null) return;
      if (!importsReactViewTransition(node)) return;
      context.report({
        node,
        message:
          "Calling `document.startViewTransition()` directly can bypass React's `<ViewTransition>` animation lifecycle.",
      });
    },
  }),
});
