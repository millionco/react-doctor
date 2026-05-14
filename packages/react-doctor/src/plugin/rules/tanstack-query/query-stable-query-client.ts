import {
  STABLE_HOOK_WRAPPERS,
  TANSTACK_QUERY_CLIENT_CLASS,
  UPPERCASE_PATTERN,
} from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const queryStableQueryClient = defineRule<Rule>({
  requires: ["tanstack-query"],
  framework: "tanstack-query",
  severity: "warn",
  category: "TanStack Query",
  recommendation:
    "Move `new QueryClient()` to module scope or wrap in `useState(() => new QueryClient())` — recreating it on every render resets the entire cache",
  examples: [
    {
      before:
        "function App() {\n  const queryClient = new QueryClient();\n  return <QueryClientProvider client={queryClient}>…</QueryClientProvider>;\n}",
      after:
        "function App() {\n  const [queryClient] = useState(() => new QueryClient());\n  return <QueryClientProvider client={queryClient}>…</QueryClientProvider>;\n}",
    },
  ],
  create: (context: RuleContext) => {
    let componentDepth = 0;
    let stableHookDepth = 0;

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (node.id?.name && UPPERCASE_PATTERN.test(node.id.name)) {
          componentDepth++;
        }
      },
      "FunctionDeclaration:exit"(node: EsTreeNode) {
        if (
          isNodeOfType(node, "FunctionDeclaration") &&
          node.id?.name &&
          UPPERCASE_PATTERN.test(node.id.name)
        ) {
          componentDepth--;
        }
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (
          isNodeOfType(node.id, "Identifier") &&
          UPPERCASE_PATTERN.test(node.id.name) &&
          (isNodeOfType(node.init, "ArrowFunctionExpression") ||
            isNodeOfType(node.init, "FunctionExpression"))
        ) {
          componentDepth++;
        }
      },
      "VariableDeclarator:exit"(node: EsTreeNode) {
        if (
          isNodeOfType(node, "VariableDeclarator") &&
          isNodeOfType(node.id, "Identifier") &&
          UPPERCASE_PATTERN.test(node.id.name) &&
          (isNodeOfType(node.init, "ArrowFunctionExpression") ||
            isNodeOfType(node.init, "FunctionExpression"))
        ) {
          componentDepth--;
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (isHookCall(node, STABLE_HOOK_WRAPPERS)) {
          stableHookDepth++;
        }
      },
      "CallExpression:exit"(node: EsTreeNode) {
        if (isHookCall(node, STABLE_HOOK_WRAPPERS)) {
          stableHookDepth = Math.max(0, stableHookDepth - 1);
        }
      },
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        if (componentDepth <= 0) return;
        if (stableHookDepth > 0) return;
        if (
          !isNodeOfType(node.callee, "Identifier") ||
          node.callee.name !== TANSTACK_QUERY_CLIENT_CLASS
        )
          return;

        context.report({
          node,
          message:
            "new QueryClient() inside a component — creates a new cache on every render. Move to module scope or wrap in useState(() => new QueryClient())",
        });
      },
    };
  },
});
