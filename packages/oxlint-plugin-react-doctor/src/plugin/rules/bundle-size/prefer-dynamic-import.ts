import { HEAVY_LIBRARIES } from "../../constants/library.js";
import { defineRule } from "../../utils/define-rule.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const preferDynamicImport = defineRule({
  id: "prefer-dynamic-import",
  title: "Heavy library loaded eagerly",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Load it only when needed: `const Component = dynamic(() => import('library'), { ssr: false })` from next/dynamic, or React.lazy().",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      const source = node.source?.value;
      if (typeof source !== "string" || !HEAVY_LIBRARIES.has(source)) return;
      // Type-only imports are erased at emit time; a bare side-effect
      // import (`import 'foo'`) still has a real runtime cost, so it stays.
      if (isTypeOnlyImport(node)) return;
      context.report({
        node,
        message: `"${source}" ships extra code to your users up front & slows page load. Load it on demand with React.lazy() or next/dynamic.`,
      });
    },
  }),
});
