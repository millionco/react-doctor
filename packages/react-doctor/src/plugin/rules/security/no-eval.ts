import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const noEval = defineRule<Rule>({
  recommendation:
    "Use `JSON.parse` for serialized data, `Function(...)` (still careful) for trusted templates, or refactor to avoid dynamic code execution",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type === "Identifier" && node.callee.name === "eval") {
        context.report({
          node,
          message: "eval() is a code injection risk — avoid dynamic code execution",
        });
        return;
      }

      if (
        node.callee?.type === "Identifier" &&
        (node.callee.name === "setTimeout" || node.callee.name === "setInterval") &&
        node.arguments?.[0]?.type === "Literal" &&
        typeof node.arguments[0].value === "string"
      ) {
        context.report({
          node,
          message: `${node.callee.name}() with string argument executes code dynamically — use a function instead`,
        });
      }
    },
    NewExpression(node: EsTreeNode) {
      if (node.callee?.type === "Identifier" && node.callee.name === "Function") {
        context.report({
          node,
          message: "new Function() is a code injection risk — avoid dynamic code execution",
        });
      }
    },
  }),
});
