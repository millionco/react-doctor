import { APP_DIRECTORY_PATTERN } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const nextjsNoHeadImport = defineRule<Rule>({
  framework: "nextjs",
  severity: "error",
  category: "Next.js",
  recommendation:
    "Use the Metadata API instead: `export const metadata = { title: '...' }` or `export async function generateMetadata()`",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNode) {
      if (node.source?.value !== "next/head") return;

      const filename = context.getFilename?.() ?? "";
      if (!APP_DIRECTORY_PATTERN.test(filename)) return;

      context.report({
        node,
        message: "next/head is not supported in the App Router — use the Metadata API instead",
      });
    },
  }),
});
