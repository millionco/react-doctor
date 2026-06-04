import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsNoVercelOgImport = defineRule<Rule>({
  id: "nextjs-no-vercel-og-import",
  title: "@vercel/og import instead of next/og",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    'Use `import { ImageResponse } from "next/og"`. The `@vercel/og` package is built into Next.js and should not be imported directly',
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      if (node.source?.value !== "@vercel/og") return;

      context.report({
        node,
        message:
          '@vercel/og is bundled into Next.js. Import from "next/og" instead to avoid duplicate code and version mismatch.',
      });
    },
  }),
});
