import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noEval = defineRule<Rule>({
  id: "no-eval",
  title: "eval() runs untrusted code strings",
  severity: "error",
  recommendation:
    "Use `JSON.parse` for data, or rewrite the code so it doesn't build and run code from strings.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (isNodeOfType(node.callee, "Identifier") && node.callee.name === "eval") {
        context.report({
          node,
          message: "eval() is a code-injection vulnerability: it runs any string as code.",
        });
        return;
      }

      if (
        isNodeOfType(node.callee, "Identifier") &&
        (node.callee.name === "setTimeout" || node.callee.name === "setInterval") &&
        isNodeOfType(node.arguments?.[0], "Literal") &&
        typeof node.arguments[0].value === "string"
      ) {
        context.report({
          node,
          message: `Passing a string to ${node.callee.name}() is a code-injection vulnerability, since it runs that string as code.`,
        });
      }
    },
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      if (isNodeOfType(node.callee, "Identifier") && node.callee.name === "Function") {
        context.report({
          node,
          message:
            "new Function() is a code-injection vulnerability: it builds & runs code from a string.",
        });
      }
    },
  }),
});
