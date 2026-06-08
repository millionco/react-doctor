import { OG_ROUTE_PATTERN } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import { isNextjsMetadataImageRouteFilename } from "../../utils/is-nextjs-metadata-image-route-filename.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
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
  create: (context: RuleContext) => {
    const filename = normalizeFilename(context.filename ?? "");
    const isOgRoute = OG_ROUTE_PATTERN.test(filename);
    const isMetadataImageRoute = isNextjsMetadataImageRouteFilename(filename);

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isOgRoute || isMetadataImageRoute) return;
        if (isNodeOfType(node.name, "JSXIdentifier") && node.name.name === "img") {
          context.report({
            node,
            message: "Plain <img> ships unoptimized, oversized images to your users.",
          });
        }
      },
    };
  },
});
