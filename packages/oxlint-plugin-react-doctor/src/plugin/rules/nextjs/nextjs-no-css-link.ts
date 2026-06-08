import { GOOGLE_FONTS_PATTERN } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsNoCssLink = defineRule<Rule>({
  id: "nextjs-no-css-link",
  title: "Linked stylesheet bypasses Next.js CSS optimization",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    "Import CSS directly or use CSS Modules so Next.js can bundle, order, and optimize the stylesheet.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "link") return;
      const attributes = node.attributes ?? [];

      const relAttribute = findJsxAttribute(attributes, "rel");
      if (!relAttribute?.value) return;
      const relValue = isNodeOfType(relAttribute.value, "Literal")
        ? relAttribute.value.value
        : null;
      if (relValue !== "stylesheet") return;

      const hrefAttribute = findJsxAttribute(attributes, "href");
      if (!hrefAttribute?.value) return;
      const hrefValue = isNodeOfType(hrefAttribute.value, "Literal")
        ? hrefAttribute.value.value
        : null;
      if (typeof hrefValue === "string" && GOOGLE_FONTS_PATTERN.test(hrefValue)) return;

      context.report({
        node,
        message:
          'This <link rel="stylesheet"> bypasses Next.js CSS handling, so the CSS loads unbundled and unoptimized.',
      });
    },
  }),
});
