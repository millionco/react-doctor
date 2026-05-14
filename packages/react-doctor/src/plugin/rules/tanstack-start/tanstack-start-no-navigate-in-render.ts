import { EFFECT_HOOK_NAMES, UPPERCASE_PATTERN } from "../../constants/react.js";
import { TANSTACK_ROUTE_FILE_PATTERN } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const tanstackStartNoNavigateInRender = defineRule<Rule>({
  id: "tanstack-start-no-navigate-in-render",
  requires: ["tanstack-start"],
  framework: "tanstack-start",
  severity: "warn",
  category: "TanStack Start",
  recommendation:
    "Use `throw redirect({ to: '/path' })` in `beforeLoad` or `loader` instead — navigate() during render causes hydration issues",
  examples: [
    {
      before:
        "function Page() {\n  const navigate = useNavigate();\n  if (!user) navigate({ to: '/login' });\n  return <Profile />;\n}",
      after:
        "export const Route = createFileRoute('/profile')({\n  beforeLoad: () => { if (!user) throw redirect({ to: '/login' }); },\n});",
    },
  ],
  create: (context: RuleContext) => {
    // HACK: only callbacks that React calls LATER are safe scopes for
    // navigate() — useEffect / useLayoutEffect (post-commit), useCallback
    // / useMemo (cached, fired by event handlers later), and JSX `onXxx`
    // attributes (event handlers). Synchronous-iteration callbacks like
    // `arr.forEach(item => navigate(item))` execute during render, so
    // they must NOT be treated as deferred — they're still render-time
    // side effects. A pure function-depth counter would skip them and
    // miss real bugs; the explicit allow-list is the correct boundary.
    let deferredCallbackDepth = 0;
    let eventHandlerDepth = 0;

    const isDeferredHookCall = (node: EsTreeNode): boolean =>
      isHookCall(node, EFFECT_HOOK_NAMES) ||
      isHookCall(node, "useCallback") ||
      isHookCall(node, "useMemo");

    const isEventHandlerAttribute = (node: EsTreeNode): boolean =>
      isNodeOfType(node, "JSXAttribute") &&
      isNodeOfType(node.name, "JSXIdentifier") &&
      typeof node.name.name === "string" &&
      node.name.name.startsWith("on") &&
      UPPERCASE_PATTERN.test(node.name.name.charAt(2));

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const filename = context.getFilename?.() ?? "";
        if (!TANSTACK_ROUTE_FILE_PATTERN.test(filename)) return;

        if (isDeferredHookCall(node)) deferredCallbackDepth++;

        if (deferredCallbackDepth > 0 || eventHandlerDepth > 0) return;

        if (
          isNodeOfType(node.callee, "Identifier") &&
          node.callee.name === "navigate" &&
          (node.arguments?.length ?? 0) > 0
        ) {
          context.report({
            node,
            message:
              "navigate() called during render — use redirect() in beforeLoad/loader for route-level redirects",
          });
        }
      },
      "CallExpression:exit"(node: EsTreeNode) {
        const filename = context.getFilename?.() ?? "";
        if (!TANSTACK_ROUTE_FILE_PATTERN.test(filename)) return;
        if (isDeferredHookCall(node)) {
          deferredCallbackDepth = Math.max(0, deferredCallbackDepth - 1);
        }
      },
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        const filename = context.getFilename?.() ?? "";
        if (!TANSTACK_ROUTE_FILE_PATTERN.test(filename)) return;
        if (isEventHandlerAttribute(node)) eventHandlerDepth++;
      },
      "JSXAttribute:exit"(node: EsTreeNode) {
        const filename = context.getFilename?.() ?? "";
        if (!TANSTACK_ROUTE_FILE_PATTERN.test(filename)) return;
        if (isEventHandlerAttribute(node)) {
          eventHandlerDepth = Math.max(0, eventHandlerDepth - 1);
        }
      },
    };
  },
});
