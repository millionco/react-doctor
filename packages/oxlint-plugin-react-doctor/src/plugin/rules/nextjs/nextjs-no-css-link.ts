import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getJsxPropStaticStringValues } from "../../utils/get-jsx-prop-static-string-values.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";

const HTTP_STYLESHEET_URL_PATTERN = /^https?:\/\//i;

export const nextjsNoCssLink = defineRule({
  id: "nextjs-no-css-link",
  title: "Linked stylesheet bypasses Next.js CSS optimization",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    "Import CSS directly or use CSS Modules so Next.js can bundle, order, and optimize the stylesheet.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (resolveJsxElementType(node) !== "link") return;
      const attributes = node.attributes ?? [];

      const relAttribute = findJsxAttribute(attributes, "rel");
      if (!relAttribute?.value) return;
      const relValue = isNodeOfType(relAttribute.value, "Literal")
        ? relAttribute.value.value
        : null;
      if (relValue !== "stylesheet") return;

      const declaredHrefAttribute = findJsxAttribute(attributes, "href");
      if (!declaredHrefAttribute?.value) return;
      const authoritativeHrefAttribute = getAuthoritativeJsxAttribute(attributes, "href");
      const hrefCandidates = authoritativeHrefAttribute
        ? getJsxPropStaticStringValues(authoritativeHrefAttribute, context.scopes)
        : null;
      if (
        hrefCandidates !== null &&
        hrefCandidates.length > 0 &&
        hrefCandidates.every((hrefCandidate) => HTTP_STYLESHEET_URL_PATTERN.test(hrefCandidate))
      ) {
        return;
      }

      context.report({
        node,
        message:
          'This <link rel="stylesheet"> bypasses Next.js CSS handling, so the CSS loads unbundled and unoptimized.',
      });
    },
  }),
});
