import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { resolveTanstackQueryHookNameFromInitializer } from "./utils/resolve-tanstack-query-hook-name.js";

export const queryNoRestDestructuring = defineRule({
  id: "query-no-rest-destructuring",
  title: "Rest destructuring on query result",
  tags: ["test-noise"],
  requires: ["tanstack-query"],
  severity: "warn",
  recommendation:
    "Destructure only the fields you need, like `const { data, isLoading } = useQuery(...)`. Rest destructuring subscribes to every field and adds re-renders.",
  create: (context: RuleContext) => ({
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!isNodeOfType(node.id, "ObjectPattern")) return;
      if (!node.init) return;

      const hasRestElement = node.id.properties?.some((property: EsTreeNode) =>
        isNodeOfType(property, "RestElement"),
      );
      if (!hasRestElement) return;

      const hookName = resolveTanstackQueryHookNameFromInitializer(node.init, context.scopes);
      if (!hookName) return;

      context.report({
        node: node.id,
        message: `Rest-destructuring ${hookName}() subscribes to every field, so it re-renders on each change.`,
      });
    },
  }),
});
