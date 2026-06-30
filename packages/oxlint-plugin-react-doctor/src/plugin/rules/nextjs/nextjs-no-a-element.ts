import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsNoAElement = defineRule({
  id: "nextjs-no-a-element",
  title: "Plain anchor reloads internal Next.js links",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    "`import Link from 'next/link'` for client-side navigation, prefetching, and preserved scroll position",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "a") return;

      const attributes = node.attributes ?? [];

      // `next/link` has no equivalent for a file download or a new-tab link, so
      // a plain anchor is the correct element in those cases.
      if (findJsxAttribute(attributes, "download")) return;
      const targetAttribute = findJsxAttribute(attributes, "target");
      if (
        targetAttribute?.value &&
        isNodeOfType(targetAttribute.value, "Literal") &&
        targetAttribute.value.value === "_blank"
      ) {
        return;
      }

      const hrefAttribute = findJsxAttribute(attributes, "href");
      if (!hrefAttribute?.value) return;

      let hrefValue = null;
      if (isNodeOfType(hrefAttribute.value, "Literal")) {
        hrefValue = hrefAttribute.value.value;
      } else if (
        isNodeOfType(hrefAttribute.value, "JSXExpressionContainer") &&
        isNodeOfType(hrefAttribute.value.expression, "Literal")
      ) {
        hrefValue = hrefAttribute.value.expression.value;
      }

      if (
        typeof hrefValue === "string" &&
        hrefValue.startsWith("/") &&
        !hrefValue.startsWith("//")
      ) {
        context.report({
          node,
          message:
            "Plain <a> reloads the whole page for internal links, so Next.js loses client-side navigation and prefetching.",
        });
      }
    },
  }),
});
