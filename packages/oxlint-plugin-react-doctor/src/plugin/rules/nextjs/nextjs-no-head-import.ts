import { defineRule } from "../../utils/define-rule.js";
import { isInProjectDirectory } from "../../utils/is-in-project-directory.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsNoHeadImport = defineRule({
  id: "nextjs-no-head-import",
  title: "next/head in App Router",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "error",
  recommendation:
    "Use the Metadata API because `next/head` is ignored in the App Router and meta tags will not render.",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      if (node.source?.value !== "next/head") return;

      if (!isInProjectDirectory(context, "app")) return;

      context.report({
        node,
        message:
          "next/head silently does nothing in the App Router, so your meta tags never render.",
      });
    },
  }),
});
