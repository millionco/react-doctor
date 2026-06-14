import {
  TANSTACK_QUERY_HOOK_IMPORT_SOURCES,
  TANSTACK_QUERY_HOOKS,
} from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const queryDestructureResult = defineRule({
  id: "query-destructure-result",
  title: "Whole query result subscribes to every field",
  tags: ["test-noise"],
  requires: ["tanstack-query"],
  severity: "error",
  recommendation:
    "Destructure only the fields you need, like `const { data, isLoading } = useQuery(...)`. Assigning the whole object bypasses TanStack Query's tracked-property optimization and subscribes to every field.",
  create: (context: RuleContext) => {
    const tanstackQueryHookLocalNames = new Set<string>();

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        const source = node.source?.value;
        if (typeof source !== "string") return;
        if (!TANSTACK_QUERY_HOOK_IMPORT_SOURCES.has(source)) return;
        for (const specifier of node.specifiers ?? []) {
          if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
          if (!isNodeOfType(specifier.local, "Identifier")) continue;
          const importedName = getImportedName(specifier);
          if (importedName && TANSTACK_QUERY_HOOKS.has(importedName)) {
            tanstackQueryHookLocalNames.add(specifier.local.name);
          }
        }
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (tanstackQueryHookLocalNames.size === 0) return;
        if (!isNodeOfType(node.id, "Identifier")) return;
        if (!node.init || !isNodeOfType(node.init, "CallExpression")) return;
        if (!isNodeOfType(node.init.callee, "Identifier")) return;

        const calleeName = node.init.callee.name;
        if (!tanstackQueryHookLocalNames.has(calleeName)) return;

        context.report({
          node: node.id,
          message: `Destructure ${calleeName}() results instead of assigning the whole query object, so TanStack Query only subscribes to the fields you use.`,
        });
      },
    };
  },
});
