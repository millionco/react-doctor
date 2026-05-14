import { HEAVY_LIBRARIES } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const preferDynamicImport = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Bundle Size",
  recommendation:
    "Use `const Component = dynamic(() => import('library'), { ssr: false })` from next/dynamic or React.lazy()",
  examples: [
    {
      before: "import Chart from 'chart.js';",
      after:
        "import dynamic from 'next/dynamic';\nconst Chart = dynamic(() => import('chart.js'), { ssr: false });",
    },
  ],
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      const source = node.source?.value;
      if (typeof source === "string" && HEAVY_LIBRARIES.has(source)) {
        context.report({
          node,
          message: `"${source}" is a heavy library — use React.lazy() or next/dynamic for code splitting`,
        });
      }
    },
  }),
});
