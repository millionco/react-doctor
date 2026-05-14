import { BARREL_INDEX_SUFFIXES } from "../../constants/dom.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noBarrelImport = defineRule<Rule>({
  id: "no-barrel-import",
  framework: "global",
  severity: "warn",
  category: "Bundle Size",
  recommendation:
    "Import from the direct path: `import { Button } from './components/Button'` instead of `./components`",
  examples: [
    {
      before: "import { Button } from './components';",
      after: "import { Button } from './components/Button';",
    },
  ],
  create: (context: RuleContext) => {
    let didReportForFile = false;

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        if (didReportForFile) return;

        const source = node.source?.value;
        if (typeof source !== "string" || !source.startsWith(".")) return;

        if (BARREL_INDEX_SUFFIXES.some((suffix) => source.endsWith(suffix))) {
          didReportForFile = true;
          context.report({
            node,
            message:
              "Import from barrel/index file — import directly from the source module for better tree-shaking",
          });
        }
      },
    };
  },
});
