import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const queryNoQueryInEffect = defineRule<Rule>({
  id: "query-no-query-in-effect",
  requires: ["tanstack-query"],
  framework: "tanstack-query",
  severity: "warn",
  category: "TanStack Query",
  recommendation:
    "React Query manages refetching automatically via queryKey dependencies and the `enabled` option — manual refetch() in useEffect is usually unnecessary",
  examples: [
    {
      before:
        "const { refetch } = useQuery({ queryKey: ['user', id], queryFn });\nuseEffect(() => { refetch(); }, [id]);",
      after: "useQuery({ queryKey: ['user', id], queryFn });",
    },
  ],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;

      const callback = getEffectCallback(node);
      if (!callback) return;

      walkAst(callback, (child: EsTreeNode) => {
        if (!isNodeOfType(child, "CallExpression")) return;

        const calleeName = isNodeOfType(child.callee, "Identifier") ? child.callee.name : null;

        if (calleeName === "refetch") {
          context.report({
            node: child,
            message:
              "refetch() inside useEffect — React Query manages refetching automatically. Use queryKey dependencies or the enabled option instead",
          });
        }
      });
    },
  }),
});
