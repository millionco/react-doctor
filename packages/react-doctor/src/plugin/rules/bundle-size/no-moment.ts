import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noMoment = defineRule<Rule>({
  id: "no-moment",
  framework: "global",
  severity: "warn",
  category: "Bundle Size",
  recommendation:
    "Replace with `import { format } from 'date-fns'` (tree-shakeable) or `import dayjs from 'dayjs'` (2kb)",
  examples: [
    {
      before: "import moment from 'moment';\nmoment().format('YYYY-MM-DD');",
      after: "import dayjs from 'dayjs';\ndayjs().format('YYYY-MM-DD');",
    },
  ],
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      if (node.source?.value === "moment") {
        context.report({
          node,
          message: 'moment.js is 300kb+ — use "date-fns" or "dayjs" instead',
        });
      }
    },
  }),
});
