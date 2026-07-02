import { GOOGLE_FONTS_PATTERN } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsNoFontLink = defineRule({
  id: "nextjs-no-font-link",
  title: "Google Fonts loaded via link",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    '`import { Inter } from "next/font/google"` for self-hosting, zero layout shift, and no render-blocking requests',
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "link") return;
      const attributes = node.attributes ?? [];

      const hrefAttribute = findJsxAttribute(attributes, "href");
      if (!hrefAttribute?.value) return;

      // A `preconnect` / `dns-prefetch` / `preload` <link> to Google Fonts
      // downloads no CSS and no font — it is a non-blocking performance hint,
      // not the render-blocking stylesheet this rule targets. Only report a
      // stylesheet (or a <link> with no `rel`, which the browser treats as one).
      const relAttribute = findJsxAttribute(attributes, "rel");
      const relValue =
        relAttribute?.value && isNodeOfType(relAttribute.value, "Literal")
          ? relAttribute.value.value
          : null;
      if (typeof relValue === "string" && relValue !== "stylesheet") return;

      const hrefValue = isNodeOfType(hrefAttribute.value, "Literal")
        ? hrefAttribute.value.value
        : null;

      if (typeof hrefValue === "string" && GOOGLE_FONTS_PATTERN.test(hrefValue)) {
        context.report({
          node,
          message: "Loading Google Fonts with <link> blocks rendering & shifts layout.",
        });
      }
    },
  }),
});
