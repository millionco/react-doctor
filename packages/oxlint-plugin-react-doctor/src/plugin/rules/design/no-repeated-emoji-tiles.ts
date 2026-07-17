import { REPEATED_EMOJI_TILE_MIN_COUNT } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxOpeningElements } from "../../utils/get-static-jsx-opening-elements.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { hasVisibleTailwindBackground } from "./utils/has-visible-tailwind-fill-or-edge.js";
import { isTopLevelPageCopyRoot } from "./utils/is-top-level-page-copy-root.js";

const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
const EMOJI_SEQUENCE_PART_PATTERN =
  /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200d|\ufe0f|\s/gu;
const TILE_SIZE_PATTERN = /^size-(?:8|9|10|11|12|14|16)$/;
const TILE_HEIGHT_PATTERN = /^h-(?:8|9|10|11|12|14|16)$/;
const TILE_WIDTH_PATTERN = /^w-(?:8|9|10|11|12|14|16)$/;
const ROUNDING_PATTERN = /^rounded(?:-(?:[2-9]xl|full|lg|md|sm|xl|xs))?$/;

const isEmojiTile = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const element = openingElement.parent;
  if (!isNodeOfType(element, "JSXElement")) return false;
  const text = getStaticJsxText(element).trim();
  if (!EMOJI_PATTERN.test(text) || text.replace(EMOJI_SEQUENCE_PART_PATTERN, "")) return false;
  const classNameValue = getStringFromClassNameAttr(openingElement);
  if (!classNameValue) return false;
  const tokens = getUnvariantClassNameTokens(classNameValue);
  const hasSquareSize =
    tokens.some((token) => TILE_SIZE_PATTERN.test(token)) ||
    (tokens.some((token) => TILE_HEIGHT_PATTERN.test(token)) &&
      tokens.some((token) => TILE_WIDTH_PATTERN.test(token)));
  return (
    hasSquareSize &&
    tokens.some((token) => ROUNDING_PATTERN.test(token)) &&
    hasVisibleTailwindBackground(tokens)
  );
};

export const noRepeatedEmojiTiles = defineRule({
  id: "no-repeated-emoji-tiles",
  title: "Page repeats boxed emoji as feature icons",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Use a coherent icon set or product-specific artwork instead of repeating platform-dependent emoji tiles.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!isTopLevelPageCopyRoot(node)) return;
      const emojiTileCount = getStaticJsxOpeningElements(node).filter(isEmojiTile).length;
      if (emojiTileCount < REPEATED_EMOJI_TILE_MIN_COUNT) return;
      context.report({
        node: node.openingElement,
        message: `This page uses ${emojiTileCount} rounded emoji tiles as its icon system. Replace them with a consistent visual language tied to the product.`,
      });
    },
  }),
});
