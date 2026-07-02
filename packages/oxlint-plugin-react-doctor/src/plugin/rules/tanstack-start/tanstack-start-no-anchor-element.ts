import { defineRule } from "../../utils/define-rule.js";
import { isInProjectDirectory } from "../../utils/is-in-project-directory.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const getAttributeStringValue = (attribute: EsTreeNode | undefined): string | null => {
  if (!attribute || !isNodeOfType(attribute, "JSXAttribute") || !attribute.value) return null;
  if (isNodeOfType(attribute.value, "Literal") && typeof attribute.value.value === "string") {
    return attribute.value.value;
  }
  if (
    isNodeOfType(attribute.value, "JSXExpressionContainer") &&
    isNodeOfType(attribute.value.expression, "Literal") &&
    typeof attribute.value.expression.value === "string"
  ) {
    return attribute.value.expression.value;
  }
  return null;
};

export const tanstackStartNoAnchorElement = defineRule({
  id: "tanstack-start-no-anchor-element",
  title: "Plain anchor reloads TanStack Router navigation",
  tags: ["test-noise"],
  requires: ["tanstack-start"],
  severity: "warn",
  recommendation:
    "Use `Link` from `@tanstack/react-router` so internal navigation keeps client state, preloading, and typed routes.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isInProjectDirectory(context, "routes")) return;

      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "a") return;

      const attributes = node.attributes ?? [];
      const hrefAttribute = findJsxAttribute(attributes, "href");
      if (!hrefAttribute?.value) return;

      let hrefValue: string | number | bigint | boolean | RegExp | null = null;
      if (isNodeOfType(hrefAttribute.value, "Literal")) {
        hrefValue = hrefAttribute.value.value;
      } else if (
        isNodeOfType(hrefAttribute.value, "JSXExpressionContainer") &&
        isNodeOfType(hrefAttribute.value.expression, "Literal")
      ) {
        hrefValue = hrefAttribute.value.expression.value;
      }

      if (typeof hrefValue !== "string" || !hrefValue.startsWith("/")) return;

      // A protocol-relative URL (`//cdn.example.com/...`) is an EXTERNAL link
      // that merely starts with "/".
      if (hrefValue.startsWith("//")) return;

      // Non-route paths can't be a router Link: API endpoints/exports and
      // static assets with a file extension (`/resume.pdf`, `/sitemap.xml`).
      const pathname = hrefValue.split(/[?#]/)[0] ?? hrefValue;
      if (pathname.startsWith("/api/")) return;
      if (/\.[a-z0-9]{1,8}$/i.test(pathname)) return;

      // A `download` link or a new-tab link must stay a real <a>; a Link
      // can't trigger a browser download or open in a new tab the same way.
      if (findJsxAttribute(attributes, "download")) return;
      if (getAttributeStringValue(findJsxAttribute(attributes, "target")) === "_blank") return;

      context.report({
        node,
        message:
          "Plain <a> reloads the whole page for internal navigation, so TanStack Router loses client state and preloading.",
      });
    },
  }),
});
