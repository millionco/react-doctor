import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

export const noEval = defineRule<Rule>({
  framework: "global",
  severity: "error",
  category: "Security",
  recommendation:
    "Use `JSON.parse` for serialized data, `Function(...)` (still careful) for trusted templates, or refactor to avoid dynamic code execution",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (isNodeOfType(node.callee, "Identifier") && node.callee.name === "eval") {
        context.report({
          node,
          message: "eval() is a code injection risk — avoid dynamic code execution",
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
          message: `${node.callee.name}() with string argument executes code dynamically — use a function instead`,
        });
      }
    },
    NewExpression(node: EsTreeNode) {
      if (isNodeOfType(node.callee, "Identifier") && node.callee.name === "Function") {
        context.report({
          node,
          message: "new Function() is a code injection risk — avoid dynamic code execution",
        });
      }
    },
  }),
});
