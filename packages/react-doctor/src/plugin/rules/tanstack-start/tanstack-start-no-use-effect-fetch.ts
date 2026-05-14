import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { TANSTACK_ROUTE_FILE_PATTERN } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const tanstackStartNoUseEffectFetch = defineRule<Rule>({
  requires: ["tanstack-start"],
  framework: "tanstack-start",
  severity: "warn",
  category: "TanStack Start",
  recommendation:
    "Fetch data in the route `loader` instead — the router coordinates loading before rendering to avoid waterfalls",
  examples: [
    {
      before:
        "function Component() {\n  useEffect(() => { fetch('/api/user').then((r) => r.json()).then(setUser); }, []);\n}",
      after:
        "export const Route = createFileRoute('/users')({\n  loader: () => fetch('/api/user').then((r) => r.json()),\n});",
    },
  ],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const filename = context.getFilename?.() ?? "";
      const isRouteFile = TANSTACK_ROUTE_FILE_PATTERN.test(filename);
      if (!isRouteFile) return;

      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;

      const callback = node.arguments?.[0];
      if (!callback) return;

      let hasFetchCall = false;
      walkAst(callback, (child: EsTreeNode) => {
        if (hasFetchCall) return;
        if (
          isNodeOfType(child, "CallExpression") &&
          isNodeOfType(child.callee, "Identifier") &&
          child.callee.name === "fetch"
        ) {
          hasFetchCall = true;
        }
      });

      if (hasFetchCall) {
        context.report({
          node,
          message:
            "fetch() inside useEffect in a route file — use the route loader or createServerFn() instead",
        });
      }
    },
  }),
});
