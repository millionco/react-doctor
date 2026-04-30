import type { EsTreeNode, Rule, RuleContext } from "../types.js";

// HACK: in React's <ViewTransition> world, calling
// `document.startViewTransition()` directly bypasses React's lifecycle
// hooks and can fight the auto-generated `viewTransitionName`s React
// emits. The supported way is to render <ViewTransition> and let React
// call startViewTransition for you (around startTransition, useDeferredValue,
// or Suspense reveals).
export const noDocumentStartViewTransition: Rule = {
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
};

// HACK: `flushSync` from react-dom forces a synchronous flush, which
// skips the View Transition snapshot phase entirely — any animation that
// would have triggered is silently dropped. We report only on the import
// (a single actionable diagnostic per file) instead of on every call
// site, which would clutter output for files with several flushSync()s.
export const noFlushSync: Rule = {
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNode) {
      if (node.source?.value !== "react-dom") return;
      for (const specifier of node.specifiers ?? []) {
        if (specifier.type !== "ImportSpecifier") continue;
        if (specifier.imported?.name === "flushSync") {
          context.report({
            node: specifier,
            message:
              "flushSync from react-dom skips View Transition snapshots and concurrent rendering — prefer startTransition for non-urgent updates",
          });
        }
      }
    },
  }),
};
