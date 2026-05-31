import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noMoment = defineRule<Rule>({
  id: "no-moment",
  title: "Using moment.js",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Switch to `import { format } from 'date-fns'` or `import dayjs from 'dayjs'` (2kb).",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      if (node.source?.value === "moment") {
        context.report({
          node,
          message:
            'moment.js ships 300 kb+ to your users & slows page load. Use "date-fns" or "dayjs" instead.',
        });
      }
    },
  }),
});
