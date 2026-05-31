import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: bundlers can only tree-shake / split when the import target is a
// statically-analyzable string literal. `import(variable)` or
// `require(variable)` defeats trace targets and forces a fat bundle.
export const noDynamicImportPath = defineRule<Rule>({
  id: "no-dynamic-import-path",
  title: "Non-static dynamic import path",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Use a plain string path: `import('./feature/heavy.js')` so the bundler can split this into its own chunk.",
  create: (context: RuleContext) => ({
    ImportExpression(node: EsTreeNodeOfType<"ImportExpression">) {
      const source = node.source;
      if (source && !isNodeOfType(source, "Literal") && !isNodeOfType(source, "TemplateLiteral")) {
        context.report({
          node,
          message:
            "This ships in the main bundle & slows page load, since the bundler can't code-split a dynamic import path. Use a plain string path instead.",
        });
        return;
      }
      if (isNodeOfType(source, "TemplateLiteral") && (source.expressions?.length ?? 0) > 0) {
        context.report({
          node,
          message:
            "This ships in the main bundle & slows page load, since the bundler can't code-split a dynamic import path. Use a plain string path instead of one with `${...}`.",
        });
      }
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "require") return;
      const arg = node.arguments?.[0];
      if (!arg) return;
      if (!isNodeOfType(arg, "Literal") && !isNodeOfType(arg, "TemplateLiteral")) {
        context.report({
          node,
          message:
            "This ships in the main bundle & slows page load, since the bundler can't trace a dynamic require() path. Use a plain string path instead.",
        });
        return;
      }
      if (isNodeOfType(arg, "TemplateLiteral") && (arg.expressions?.length ?? 0) > 0) {
        context.report({
          node,
          message:
            "This ships in the main bundle & slows page load, since the bundler can't trace a dynamic require() path. Use a plain string path instead of one with `${...}`.",
        });
      }
    },
  }),
});
