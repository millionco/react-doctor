import { defineRule } from "../../utils/define-rule.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const TITLE_CONTROL_ELEMENTS = new Set(["a", "button", "summary"]);

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();

export const noRedundantTitleTooltip = defineRule({
  id: "no-redundant-title-tooltip",
  title: "Title tooltip repeats visible control text",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation: "Remove tooltips that merely repeat a control's visible label.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
        !TITLE_CONTROL_ELEMENTS.has(node.openingElement.name.name) ||
        node.children.some((child) => isNodeOfType(child, "JSXExpressionContainer"))
      ) {
        return;
      }
      const titleAttribute = getAuthoritativeJsxAttribute(
        node.openingElement.attributes,
        "title",
        false,
      );
      if (!titleAttribute) return;
      const title = getStringLiteralAttributeValue(titleAttribute);
      const visibleText = normalizeText(getStaticJsxText(node));
      if (!title || !visibleText || normalizeText(title) !== visibleText) return;
      const tokens = getUnvariantClassNameTokens(
        getStringFromClassNameAttr(node.openingElement) ?? "",
      );
      if (
        tokens.some(
          (token) =>
            token === "truncate" || token === "text-ellipsis" || token.startsWith("line-clamp-"),
        )
      ) {
        return;
      }
      context.report({
        node: titleAttribute,
        message:
          "This title tooltip repeats text that is already visible on the control. Remove it so pointer users do not get redundant help.",
      });
    },
  }),
});
