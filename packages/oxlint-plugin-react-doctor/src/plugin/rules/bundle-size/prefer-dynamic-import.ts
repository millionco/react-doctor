import { HEAVY_LIBRARIES } from "../../constants/library.js";
import { defineRule } from "../../utils/define-rule.js";
import { isImportAbsentFromClientBundle } from "../../utils/is-import-absent-from-client-bundle.js";
import { isPublishedLibraryPackage } from "../../utils/is-published-library-package.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const preferDynamicImport = defineRule({
  id: "prefer-dynamic-import",
  title: "Heavy library loaded eagerly",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Load it only when needed: `const Component = dynamic(() => import('library'), { ssr: false })` from next/dynamic, or React.lazy().",
  create: (context: RuleContext): RuleVisitors => {
    // A published component library that wraps the heavy dependency loads it
    // eagerly by design; code-splitting is the consuming app's decision.
    if (isPublishedLibraryPackage(context.filename)) return {};
    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        const source = node.source?.value;
        if (typeof source !== "string" || !HEAVY_LIBRARIES.has(source)) return;
        // Type-only imports are erased at emit time; a bare side-effect
        // import (`import 'foo'`) still has a real runtime cost, so it stays.
        if (isTypeOnlyImport(node)) return;
        // So are imports whose bindings are referenced only in type
        // positions or Next.js server data functions — those never reach
        // the client bundle.
        if (isImportAbsentFromClientBundle(node)) return;
        context.report({
          node,
          message: `"${source}" ships extra code to your users up front & slows page load. Load it on demand with React.lazy() or next/dynamic.`,
        });
      },
    };
  },
});
