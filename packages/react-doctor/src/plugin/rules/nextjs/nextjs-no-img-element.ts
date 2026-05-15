import { OG_ROUTE_PATTERN } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsNoImgElement = defineRule<Rule>({
  id: "nextjs-no-img-element",
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    "`import Image from 'next/image'` — provides automatic WebP/AVIF, lazy loading, and responsive srcset",
  create: (context: RuleContext) => {
    const filename = context.getFilename?.() ?? "";
    const isOgRoute = OG_ROUTE_PATTERN.test(filename);

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isOgRoute) return;
        if (isNodeOfType(node.name, "JSXIdentifier") && node.name.name === "img") {
          context.report({
            node,
            message:
              "Use next/image instead of <img> — provides automatic optimization, lazy loading, and responsive srcset",
          });
        }
      },
    };
  },
});
