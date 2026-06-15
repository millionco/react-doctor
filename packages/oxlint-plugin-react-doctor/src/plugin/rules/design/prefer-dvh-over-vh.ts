import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// `h-screen`, `min-h-screen`, or arbitrary `h-[100vh]` — height only
// (`w-screen` is handled by `no-full-viewport-width`). `max-h-*` is excluded:
// `max-height: 100vh` is a common, valid cap (e.g. a scrollable modal).
const FULL_VIEWPORT_HEIGHT_CLASS = /(?:^|\s)(?:\w+:)*(?:min-)?h-(?:screen|\[100vh\])(?=$|[\s])/;
const HEIGHT_KEYS = new Set(["height", "minHeight"]);

const MESSAGE =
  "`100vh` is taller than the visible viewport on mobile (it ignores the browser's dynamic toolbars), so full-height layouts get clipped. Use the dynamic-viewport unit: `h-dvh` / `min-h-dvh` (or `100dvh`).";

export const preferDvhOverVh = defineRule({
  id: "prefer-dvh-over-vh",
  title: "Use dvh instead of vh for full height",
  tags: ["design", "test-noise"],
  severity: "warn",
  requires: ["tailwind:3.4"],
  recommendation:
    "Prefer `dvh` over `vh` for full-height elements. `100vh` overflows under mobile browser chrome; `100dvh` tracks the visible viewport. (`h-dvh`/`min-h-dvh` need Tailwind 3.4+.)",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;
      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (!key || !HEIGHT_KEYS.has(key)) continue;
        const value = getStylePropertyStringValue(property);
        if (value && value.trim().toLowerCase() === "100vh") {
          context.report({ node: property, message: MESSAGE });
        }
      }
    },
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      if (FULL_VIEWPORT_HEIGHT_CLASS.test(classNameValue)) {
        context.report({ node, message: MESSAGE });
      }
    },
  }),
});
