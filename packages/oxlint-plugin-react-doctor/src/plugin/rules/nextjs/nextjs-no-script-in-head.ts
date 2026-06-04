import { defineRule } from "../../utils/define-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsNoScriptInHead = defineRule<Rule>({
  id: "nextjs-no-script-in-head",
  title: "next/script inside next/head",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "error",
  recommendation:
    "Move `<Script>` outside of `<Head>`. next/script manages its own placement and ignores head context",
  create: (context: RuleContext) => {
    let insideHeadDepth = 0;

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;

        if (node.name.name === "Head" && !node.selfClosing) {
          insideHeadDepth++;
        }

        if (node.name.name === "Script" && insideHeadDepth > 0) {
          context.report({
            node,
            message:
              "next/script inside next/head is silently ignored. Move <Script> outside <Head> so it actually loads.",
          });
        }
      },
      JSXClosingElement(node: EsTreeNodeOfType<"JSXClosingElement">) {
        if (isNodeOfType(node.name, "JSXIdentifier") && node.name.name === "Head") {
          insideHeadDepth = Math.max(0, insideHeadDepth - 1);
        }
      },
    };
  },
});
