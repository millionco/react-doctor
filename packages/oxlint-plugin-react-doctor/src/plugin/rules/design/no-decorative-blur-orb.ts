import { DECORATIVE_BLUR_ORB_MIN_BLUR_PX } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { hasVisibleTailwindBackground } from "./utils/has-visible-tailwind-fill-or-edge.js";

const DECORATIVE_ORB_ELEMENT_NAMES = new Set(["div", "span"]);
const STRONG_BLUR_TOKENS = new Set(["blur-2xl", "blur-3xl"]);
const ARBITRARY_BLUR_PATTERN = /^blur-\[([\d.]+)px\]$/;

const hasStrongBlur = (tokens: string[]): boolean =>
  tokens.some((token) => {
    if (STRONG_BLUR_TOKENS.has(token)) return true;
    const match = token.match(ARBITRARY_BLUR_PATTERN);
    return Boolean(match && parseFloat(match[1]) >= DECORATIVE_BLUR_ORB_MIN_BLUR_PX);
  });

const hasOnlyWhitespaceChildren = (node: EsTreeNodeOfType<"JSXElement">): boolean =>
  node.children.every(
    (child) => isNodeOfType(child, "JSXText") && (child.value ?? "").trim().length === 0,
  );

export const noDecorativeBlurOrb = defineRule({
  id: "no-decorative-blur-orb",
  title: "Empty blurred color orb decorates the layout",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Use structure, imagery, or a restrained surface treatment instead of an oversized blurred color blob.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
        !DECORATIVE_ORB_ELEMENT_NAMES.has(node.openingElement.name.name) ||
        !hasOnlyWhitespaceChildren(node)
      ) {
        return;
      }
      const classNameValue = getStringFromClassNameAttr(node.openingElement);
      if (!classNameValue) return;
      const tokens = getUnvariantClassNameTokens(classNameValue);
      if (
        !tokens.some((token) => token === "absolute" || token === "fixed") ||
        !tokens.includes("rounded-full") ||
        !hasStrongBlur(tokens) ||
        !hasVisibleTailwindBackground(tokens)
      ) {
        return;
      }
      context.report({
        node: node.openingElement,
        message:
          "This empty, positioned, heavily blurred color circle is generic decorative scaffolding. Replace it with a visual tied to the product or simplify the background.",
      });
    },
  }),
});
