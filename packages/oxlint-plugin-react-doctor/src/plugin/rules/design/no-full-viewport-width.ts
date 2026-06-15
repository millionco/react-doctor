import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// `w-screen`, `min-w-screen`, or arbitrary `w-[100vw]`. `max-w-*` is excluded —
// `max-width: 100vw` is a defensive cap, not the overflow footgun.
const FULL_VIEWPORT_WIDTH_CLASS = /(?:^|\s)(?:min-)?w-(?:screen|\[100vw\])(?:$|\s)/;
const WIDTH_KEYS = new Set(["width", "minWidth"]);

const MESSAGE =
  "`100vw` is wider than the viewport whenever a scrollbar is visible, so it triggers horizontal scroll on most desktops. Use `w-full` / `width: 100%` (with the parent's padding) for a full-bleed element.";

export const noFullViewportWidth = defineRule({
  id: "no-full-viewport-width",
  title: "Full viewport width causes overflow",
  tags: ["design", "test-noise"],
  severity: "warn",
  recommendation:
    "Prefer `w-full` (`width: 100%`) over `w-screen` / `100vw`. `100vw` ignores the scrollbar gutter and overflows horizontally.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;
      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (!key || !WIDTH_KEYS.has(key)) continue;
        const value = getStylePropertyStringValue(property);
        if (value && value.trim().toLowerCase() === "100vw") {
          context.report({ node: property, message: MESSAGE });
        }
      }
    },
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      if (FULL_VIEWPORT_WIDTH_CLASS.test(classNameValue)) {
        context.report({ node, message: MESSAGE });
      }
    },
  }),
});
