import { defineRule } from "../../utils/define-rule.js";
import { isGeneratedImageRenderContext } from "../../utils/is-generated-image-render-context.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsNoImgElement = defineRule<Rule>({
  id: "nextjs-no-img-element",
  title: "Plain img ships unoptimized images",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    "Use `next/image` so users get optimized formats, responsive srcsets, and lazy loading instead of oversized image downloads.",
  create: (context: RuleContext): RuleVisitors => {
    if (isGeneratedImageRenderContext(context)) return {};

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isGeneratedImageRenderContext(context, node)) return;
        if (isNodeOfType(node.name, "JSXIdentifier") && node.name.name === "img") {
          context.report({
            node,
            message: "Plain <img> ships unoptimized, oversized images.",
          });
        }
      },
    };
  },
});
