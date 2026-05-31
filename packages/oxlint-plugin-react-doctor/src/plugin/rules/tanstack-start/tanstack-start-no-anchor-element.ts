import { TANSTACK_ROUTE_FILE_PATTERN } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const tanstackStartNoAnchorElement = defineRule<Rule>({
  id: "tanstack-start-no-anchor-element",
  title: "Plain anchor for internal navigation",
  tags: ["test-noise"],
  requires: ["tanstack-start"],
  severity: "warn",
  recommendation:
    "`import { Link } from '@tanstack/react-router'` for type-safe routes, preloading via `preload=\"intent\"`, and client-side navigation",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const filename = normalizeFilename(context.filename ?? "");
      const isRouteFile = TANSTACK_ROUTE_FILE_PATTERN.test(filename);
      if (!isRouteFile) return;

      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "a") return;

      const attributes = node.attributes ?? [];
      const hrefAttribute = attributes.find(
        (attribute) =>
          isNodeOfType(attribute, "JSXAttribute") &&
          isNodeOfType(attribute.name, "JSXIdentifier") &&
          attribute.name.name === "href",
      );

      if (!hrefAttribute || !isNodeOfType(hrefAttribute, "JSXAttribute")) return;
      if (!hrefAttribute.value) return;

      let hrefValue: string | number | bigint | boolean | RegExp | null = null;
      if (isNodeOfType(hrefAttribute.value, "Literal")) {
        hrefValue = hrefAttribute.value.value;
      } else if (
        isNodeOfType(hrefAttribute.value, "JSXExpressionContainer") &&
        isNodeOfType(hrefAttribute.value.expression, "Literal")
      ) {
        hrefValue = hrefAttribute.value.expression.value;
      }

      if (typeof hrefValue === "string" && hrefValue.startsWith("/")) {
        context.report({
          node,
          message: "Plain <a> reloads the whole page on internal navigation.",
        });
      }
    },
  }),
});
