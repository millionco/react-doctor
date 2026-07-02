import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: `undefined` doubles as "not statically knowable" (dynamic
// expression), which callers must treat differently from a literal
// `null`/`false` value.
const getJsxAttributeLiteralValue = (attributeValue: EsTreeNode | null | undefined): unknown => {
  if (!attributeValue) return undefined;
  if (isNodeOfType(attributeValue, "Literal")) return attributeValue.value;
  if (
    isNodeOfType(attributeValue, "JSXExpressionContainer") &&
    isNodeOfType(attributeValue.expression, "Literal")
  ) {
    return attributeValue.expression.value;
  }
  return undefined;
};

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

      // A file download never benefits from `next/link`; a new-tab link opens
      // a fresh document, so client-side navigation and prefetch have nothing
      // to win even though `next/link` does forward `target="_blank"`. Both
      // shapes bail out for precision. JSX omits the attribute entirely for a
      // literal `false`/`null` download value, so those are NOT download links
      // and must still fire.
      const downloadAttribute = findJsxAttribute(attributes, "download");
      if (downloadAttribute) {
        if (!downloadAttribute.value) return;
        const downloadValue = getJsxAttributeLiteralValue(downloadAttribute.value);
        if (downloadValue !== false && downloadValue !== null) return;
      }
      const targetAttribute = findJsxAttribute(attributes, "target");
      if (getJsxAttributeLiteralValue(targetAttribute?.value) === "_blank") return;

      const hrefAttribute = findJsxAttribute(attributes, "href");
      if (!hrefAttribute?.value) return;

      const hrefValue = getJsxAttributeLiteralValue(hrefAttribute.value);

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
