import { TANSTACK_SERVER_FN_FILE_PATTERN } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const tanstackStartNoDynamicServerFnImport = defineRule<Rule>({
  id: "tanstack-start-no-dynamic-server-fn-import",
  title: "Dynamic server function import",
  tags: ["test-noise"],
  requires: ["tanstack-start"],
  severity: "error",
  recommendation:
    "Use `import { myFn } from '~/utils/my.functions'`. The bundler only swaps server code for RPC stubs on static imports.",
  create: (context: RuleContext) => ({
    ImportExpression(node: EsTreeNodeOfType<"ImportExpression">) {
      const source = node.source;
      if (!source) return;

      let importPath: string | null = null;
      if (isNodeOfType(source, "Literal") && typeof source.value === "string") {
        importPath = source.value;
      } else if (isNodeOfType(source, "TemplateLiteral") && source.quasis?.length === 1) {
        importPath = source.quasis[0].value?.raw ?? null;
      }

      if (importPath && TANSTACK_SERVER_FN_FILE_PATTERN.test(importPath)) {
        context.report({
          node,
          message:
            "Dynamically importing a server-functions file leaks server code into the client bundle.",
        });
      }
    },
  }),
});
