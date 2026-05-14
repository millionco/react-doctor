import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noFullLodashImport = defineRule<Rule>({
  id: "no-full-lodash-import",
  framework: "global",
  severity: "warn",
  category: "Bundle Size",
  recommendation:
    "Import the specific function: `import debounce from 'lodash/debounce'` — saves ~70kb",
  examples: [
    {
      before: "import { debounce } from 'lodash';",
      after: "import debounce from 'lodash/debounce';",
    },
  ],
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      const source = node.source?.value;
      if (source === "lodash" || source === "lodash-es") {
        context.report({
          node,
          message: "Importing entire lodash library — import from 'lodash/functionName' instead",
        });
      }
    },
  }),
});
