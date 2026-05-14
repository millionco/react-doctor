import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getRouteOptionsObject } from "./utils/get-route-options-object.js";
import { getPropertyKeyName } from "./utils/get-property-key-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const tanstackStartNoDirectFetchInLoader = defineRule<Rule>({
  requires: ["tanstack-start"],
  framework: "tanstack-start",
  severity: "warn",
  category: "TanStack Start",
  recommendation:
    "Use `createServerFn()` from @tanstack/react-start — provides type-safe RPC, input validation, and proper server/client code splitting",
  examples: [
    {
      before: "loader: async () => { return await fetch('/api/users').then((r) => r.json()); }",
      after:
        "const getUsers = createServerFn().handler(async () => db.users.findMany());\nloader: async () => await getUsers();",
    },
  ],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const optionsObject = getRouteOptionsObject(node);
      if (!optionsObject) return;

      const properties = optionsObject.properties ?? [];
      for (const property of properties) {
        const keyName = getPropertyKeyName(property);
        if (keyName !== "loader") continue;

        const loaderValue = isNodeOfType(property, "Property") ? property.value : property;
        walkAst(loaderValue, (child: EsTreeNode) => {
          if (!isNodeOfType(child, "CallExpression")) return;
          if (isNodeOfType(child.callee, "Identifier") && child.callee.name === "fetch") {
            context.report({
              node: child,
              message:
                "Direct fetch() in route loader — use createServerFn() for type-safe server logic with automatic RPC",
            });
          }
        });
      }
    },
  }),
});
