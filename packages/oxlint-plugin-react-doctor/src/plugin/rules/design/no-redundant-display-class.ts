import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// Host elements whose default `display` is already `block`.
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

// Host elements whose default `display` is already `inline`.
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

// Standalone, unprefixed tokens. A breakpoint-prefixed `md:block` is a
// deliberate per-breakpoint override, so it's never flagged.
const STANDALONE_BLOCK = /(?:^|\s)block(?:$|\s)/;
const STANDALONE_INLINE = /(?:^|\s)inline(?:$|\s)/;

export const noRedundantDisplayClass = defineRule({
  id: "no-redundant-display-class",
  title: "Redundant display utility",
  tags: ["design", "test-noise"],
  severity: "warn",
  recommendation:
    "Drop the display class that matches the element's default (`block` on a `<div>`, `inline` on a `<span>`). It is pure noise; keep only display changes like `flex`, `grid`, or `hidden`.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      const tagName = node.name.name;
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;

      if (BLOCK_DEFAULT_TAGS.has(tagName) && STANDALONE_BLOCK.test(classNameValue)) {
        context.report({
          node,
          message: `\`block\` is the default display of \`<${tagName}>\`, so the class does nothing — remove it.`,
        });
        return;
      }
      if (INLINE_DEFAULT_TAGS.has(tagName) && STANDALONE_INLINE.test(classNameValue)) {
        context.report({
          node,
          message: `\`inline\` is the default display of \`<${tagName}>\`, so the class does nothing — remove it.`,
        });
      }
    },
  }),
});
