import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getClassNameTokens } from "../../utils/get-class-name-tokens.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const FULL_VIEWPORT_WIDTH_CLASS = /^(?:min-)?w-(?:screen|\[100vw\])$/;
const WIDTH_KEYS = new Set(["width", "minWidth"]);

const MESSAGE =
  "`100vw` is wider than the viewport whenever a scrollbar is visible, so it triggers horizontal scroll on most desktops. Use `w-full` / `width: 100%` (with the parent's padding) for a full-bleed element.";

export const noFullViewportWidth = defineRule({
  id: "no-full-viewport-width",
  title: "Full viewport width causes overflow",
  tags: ["design", "test-noise"],
  defaultEnabled: false,
  severity: "warn",
  recommendation:
    "Prefer `w-full` (`width: 100%`) over `w-screen` / `100vw`. `100vw` ignores the scrollbar gutter and overflows horizontally.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;
      for (const key of WIDTH_KEYS) {
        const property = getEffectiveStyleProperty(expression.properties, key);
        if (!property) continue;
        const value = getStylePropertyStringValue(property);
        if (value && value.trim().toLowerCase() === "100vw") {
          context.report({ node: property, message: MESSAGE });
        }
      }
    },
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      if (
        getClassNameTokens(classNameValue).some((token) => FULL_VIEWPORT_WIDTH_CLASS.test(token))
      ) {
        context.report({ node, message: MESSAGE });
      }
    },
  }),
});
