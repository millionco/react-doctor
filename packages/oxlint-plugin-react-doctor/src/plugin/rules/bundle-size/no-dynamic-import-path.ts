import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// A relative template path with a static directory segment before the first
// hole (`./locales/${lang}.js`) resolves to a bundler context module that DOES
// code-split, so it must not be flagged — unlike a protocol/absolute prefix or a
// path that leads with the interpolation, which have no analyzable static prefix.
// We require a real static segment: a `/` after the leading `./`/`../` markers.
const RELATIVE_PREFIX_PATTERN = /^(?:\.\.?\/)+/;
const hasStaticDirectoryPrefix = (template: EsTreeNodeOfType<"TemplateLiteral">): boolean => {
  const firstQuasi = template.quasis?.[0];
  if (!firstQuasi || !isNodeOfType(firstQuasi, "TemplateElement")) return false;
  const text = firstQuasi.value?.cooked ?? firstQuasi.value?.raw;
  if (typeof text !== "string") return false;
  const relativePrefix = text.match(RELATIVE_PREFIX_PATTERN);
  if (!relativePrefix) return false;
  return text.slice(relativePrefix[0].length).includes("/");
};

// HACK: bundlers can only tree-shake / split when the import target is a
// statically-analyzable string literal. `import(variable)` or
// `require(variable)` defeats trace targets and forces a fat bundle.
export const noDynamicImportPath = defineRule({
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
            "This can stay in the main bundle because the bundler cannot code-split a dynamic import path. Use a plain string path instead.",
        });
        return;
      }
      if (
        isNodeOfType(source, "TemplateLiteral") &&
        (source.expressions?.length ?? 0) > 0 &&
        !hasStaticDirectoryPrefix(source)
      ) {
        context.report({
          node,
          message:
            "This can stay in the main bundle because the bundler cannot code-split a dynamic import path with `${dynamic_path}`. Use a plain string path instead.",
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
      if (
        isNodeOfType(arg, "TemplateLiteral") &&
        (arg.expressions?.length ?? 0) > 0 &&
        !hasStaticDirectoryPrefix(arg)
      ) {
        context.report({
          node,
          message:
            "This ships in the main bundle & slows page load, since the bundler can't trace a dynamic require() path. Use a plain string path instead of one with `${...}`.",
        });
      }
    },
  }),
});
