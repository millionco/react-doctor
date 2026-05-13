import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const useLazyMotion = defineRule<Rule>({
  recommendation:
    'Use `import { LazyMotion, m } from "framer-motion"` with `domAnimation` features — saves ~30kb',
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNode) {
      const source = node.source?.value;
      if (source !== "framer-motion" && source !== "motion/react") return;

      const hasFullMotionImport = node.specifiers?.some(
        (specifier: EsTreeNode) =>
          specifier.type === "ImportSpecifier" && specifier.imported?.name === "motion",
      );

      if (hasFullMotionImport) {
        context.report({
          node,
          message: 'Import "m" with LazyMotion instead of "motion" — saves ~30kb in bundle size',
        });
      }
    },
  }),
});
