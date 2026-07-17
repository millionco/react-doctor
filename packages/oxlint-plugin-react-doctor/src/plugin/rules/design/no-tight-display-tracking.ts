import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const DISPLAY_HEADING_NAMES = new Set(["h1", "h2", "h3"]);

export const noTightDisplayTracking = defineRule({
  id: "no-tight-display-tracking",
  title: "Display heading uses the tightest tracking preset",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Use normal or moderately tight tracking so display text keeps clear character shapes across fonts and viewport sizes.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
        !DISPLAY_HEADING_NAMES.has(node.openingElement.name.name) ||
        !getStaticJsxText(node).trim()
      ) {
        return;
      }
      const classNameValue = getStringFromClassNameAttr(node.openingElement);
      if (
        !classNameValue ||
        !getUnvariantClassNameTokens(classNameValue).includes("tracking-tighter")
      ) {
        return;
      }
      context.report({
        node: node.openingElement,
        message:
          "This display heading uses the tightest tracking preset, a common generated-hero default that can crowd letterforms. Use normal or moderately tight tracking.",
      });
    },
  }),
});
