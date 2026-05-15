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
  severity: "warn",
  recommendation:
    "Use a string-literal path: `import('./feature/heavy.js')` so the bundler can split this chunk",
  create: (context: RuleContext) => ({
    ImportExpression(node: EsTreeNodeOfType<"ImportExpression">) {
      const source = node.source;
      if (source && !isNodeOfType(source, "Literal") && !isNodeOfType(source, "TemplateLiteral")) {
        context.report({
          node,
          message:
            "Dynamic import path is not statically analyzable — use a string literal so the bundler can split this chunk",
        });
        return;
      }
      if (isNodeOfType(source, "TemplateLiteral") && (source.expressions?.length ?? 0) > 0) {
        context.report({
          node,
          message:
            "Template literal with interpolation in dynamic import — use a string literal so the bundler can split this chunk",
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
            "Dynamic require() path is not statically analyzable — use a string literal so the bundler can trace this dependency",
        });
        return;
      }
      if (isNodeOfType(arg, "TemplateLiteral") && (arg.expressions?.length ?? 0) > 0) {
        context.report({
          node,
          message:
            "Template literal with interpolation in require() — use a string literal so the bundler can trace this dependency",
        });
      }
    },
  }),
});
