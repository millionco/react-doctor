import { APP_DIRECTORY_PATTERN } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsNoHeadImport = defineRule<Rule>({
  id: "nextjs-no-head-import",
  requires: ["nextjs"],
  framework: "nextjs",
  severity: "error",
  category: "Next.js",
  recommendation:
    "Use the Metadata API instead: `export const metadata = { title: '...' }` or `export async function generateMetadata()`",
  examples: [
    {
      before: "import Head from 'next/head';\n<Head><title>About</title></Head>",
      after: "export const metadata = { title: 'About' };",
    },
  ],
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
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
