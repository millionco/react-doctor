import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const useLazyMotion = defineRule<Rule>({
  id: "use-lazy-motion",
  title: "Full Framer Motion import",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    'Use `import { LazyMotion, m } from "framer-motion"` with `domAnimation` features. Saves about 30kb.',
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      const source = node.source?.value;
      if (source !== "framer-motion" && source !== "motion/react") return;
      // `import type { ... } from 'framer-motion'` ships nothing —
      // no runtime cost, the LazyMotion swap has no benefit.
      const declarationKind = (node as unknown as { importKind?: string }).importKind;
      if (declarationKind === "type") return;

      const hasFullMotionImport = node.specifiers?.some((specifier: EsTreeNode) => {
        if (!isNodeOfType(specifier, "ImportSpecifier")) return false;
        const specifierKind = (specifier as unknown as { importKind?: string }).importKind;
        if (specifierKind === "type") return false;
        return getImportedName(specifier) === "motion";
      });

      if (hasFullMotionImport) {
        context.report({
          node,
          message:
            'Importing "motion" ships about 30 kb of extra code to your users & slows page load. Use "m" with LazyMotion instead.',
        });
      }
    },
  }),
});
