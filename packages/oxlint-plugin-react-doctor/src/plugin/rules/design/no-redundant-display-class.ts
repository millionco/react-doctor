import { TAILWIND_DISPLAY_TOKENS } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const BLOCK_DEFAULT_TAGS = new Set([
  "div",
  "p",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "nav",
  "aside",
  "figure",
  "figcaption",
  "blockquote",
  "form",
  "fieldset",
  "address",
  "pre",
  "ul",
  "ol",
  "dl",
  "dt",
  "dd",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

const INLINE_DEFAULT_TAGS = new Set([
  "span",
  "a",
  "b",
  "i",
  "em",
  "strong",
  "small",
  "code",
  "abbr",
  "cite",
  "label",
  "mark",
  "q",
  "s",
  "u",
  "sub",
  "sup",
  "kbd",
  "samp",
  "var",
  "time",
]);

export const noRedundantDisplayClass = defineRule({
  id: "no-redundant-display-class",
  title: "Redundant display utility",
  tags: ["design", "test-noise", "react-jsx-only"],
  requires: ["tailwind"],
  severity: "warn",
  recommendation:
    "Drop the display class that matches the element's default (`block` on a `<div>`, `inline` on a `<span>`). It is pure noise; keep only display changes like `flex`, `grid`, or `hidden`.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      const tagName = node.name.name;
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      const classNameTokens = splitTailwindClassName(classNameValue);
      const displayTokens = new Set<string>();
      for (const classNameToken of classNameTokens) {
        if (classNameToken.startsWith("!") || classNameToken.endsWith("!")) continue;
        if (TAILWIND_DISPLAY_TOKENS.has(classNameToken)) {
          displayTokens.add(classNameToken);
        }
      }
      if (displayTokens.size !== 1) return;

      if (BLOCK_DEFAULT_TAGS.has(tagName) && displayTokens.has("block")) {
        context.report({
          node,
          message: `\`block\` is the default display of \`<${tagName}>\`, so the class does nothing — remove it.`,
        });
        return;
      }
      if (INLINE_DEFAULT_TAGS.has(tagName) && displayTokens.has("inline")) {
        context.report({
          node,
          message: `\`inline\` is the default display of \`<${tagName}>\`, so the class does nothing — remove it.`,
        });
      }
    },
  }),
});
