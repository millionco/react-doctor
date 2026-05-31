import { HEAVY_LIBRARIES } from "../../constants/library.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const preferDynamicImport = defineRule<Rule>({
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
      // `import type { … } from 'foo'` — TypeScript erases this at
      // emit time, no runtime cost. `import { type X, type Y }
      // from 'foo'` — same when every specifier is type-only.
      const declarationKind = (node as unknown as { importKind?: string }).importKind;
      if (declarationKind === "type") return;
      const specifiers = node.specifiers ?? [];
      if (specifiers.length === 0) {
        // Bare side-effect import (`import 'foo'`) — runtime cost
        // is real, flag.
      } else {
        const allTypeOnly = specifiers.every((specifier) => {
          const specifierKind = (specifier as unknown as { importKind?: string }).importKind;
          return specifierKind === "type";
        });
        if (allTypeOnly) return;
      }
      context.report({
        node,
        message: `"${source}" ships extra code to your users up front & slows page load. Load it on demand with React.lazy() or next/dynamic.`,
      });
    },
  }),
});
