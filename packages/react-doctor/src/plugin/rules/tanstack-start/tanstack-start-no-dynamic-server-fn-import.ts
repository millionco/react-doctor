import { TANSTACK_SERVER_FN_FILE_PATTERN } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const tanstackStartNoDynamicServerFnImport = defineRule<Rule>({
  requires: ["tanstack-start"],
  framework: "tanstack-start",
  severity: "error",
  category: "TanStack Start",
  recommendation:
    "Use `import { myFn } from '~/utils/my.functions'` — the bundler replaces server code with RPC stubs only for static imports",
  examples: [
    {
      before: "const { myServerFn } = await import('~/utils/my.functions');",
      after: "import { myServerFn } from '~/utils/my.functions';",
    },
  ],
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
            "Dynamic import of server functions file — use static imports so the bundler can replace server code with RPC stubs",
        });
      }
    },
  }),
});
