import { defineRule } from "../../utils/define-rule.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const DISPLAY_TEXT_CLASS_NAMES = new Set([
  "text-5xl",
  "text-6xl",
  "text-7xl",
  "text-8xl",
  "text-9xl",
]);

export const noItalicSerifDisplayHeading = defineRule({
  id: "no-italic-serif-display-heading",
  title: "Display heading combines italic serif styling",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Use a roman display face or reserve the italic serif treatment for a smaller editorial accent.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (
        !isNodeOfType(node.name, "JSXIdentifier") ||
        (node.name.name !== "h1" && node.name.name !== "h2")
      ) {
        return;
      }
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      const tokens = new Set(getUnvariantClassNameTokens(classNameValue));
      if (!tokens.has("font-serif") || !tokens.has("italic")) return;
      if (![...DISPLAY_TEXT_CLASS_NAMES].some((token) => tokens.has(token))) return;
      context.report({
        node,
        message:
          "This oversized italic serif treatment is visually overdetermined. Use roman display type or keep the italic accent smaller.",
      });
    },
  }),
});
