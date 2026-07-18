import { defineRule } from "../../utils/define-rule.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isFocusableJsxOpeningElement } from "../../utils/is-focusable-jsx-opening-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getLastMatchingToken } from "./utils/get-last-matching-token.js";

const REVEAL_VARIANTS = new Set(["focus", "focus-visible"]);
const ANCESTOR_FOCUS_VARIANTS = new Set(["focus-within", "group-focus-within"]);
const PEER_FOCUS_VARIANTS = new Set(["peer-focus", "peer-focus-visible"]);

const isVisibleOpacityUtility = (utility: string): boolean =>
  /^opacity-(?!0(?:$|\D))/.test(utility);

const isVisibleFocusIndicatorUtility = (utility: string): boolean => {
  const indicatorMatch = utility.match(/^(border|outline|ring)(?:-(.+))?$/);
  if (!indicatorMatch) return false;
  const modifier = indicatorMatch[2];
  if (!modifier) return true;
  if (/^(?:0|none|transparent)(?:$|[-/])/.test(modifier)) return false;
  return !/^(?:offset|opacity|spacing)(?:$|-)/.test(modifier);
};

const hasVariantUtility = (
  tokens: string[],
  variants: Set<string>,
  predicate: (utility: string) => boolean,
): boolean =>
  tokens.some((token) => {
    const segments = token.split(":");
    const utility = segments.at(-1) ?? "";
    return (
      segments.slice(0, -1).some((segment) => variants.has(segment.split("/")[0] ?? segment)) &&
      predicate(utility)
    );
  });

const hasLaterPeerFocusIndicator = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  classNameTokens: string[],
): boolean => {
  if (!classNameTokens.some((token) => token === "peer" || token.startsWith("peer/"))) return false;
  const controlElement = node.parent;
  if (!controlElement || !isNodeOfType(controlElement, "JSXElement")) return false;
  const parentElement = controlElement.parent;
  if (
    !parentElement ||
    (!isNodeOfType(parentElement, "JSXElement") && !isNodeOfType(parentElement, "JSXFragment"))
  ) {
    return false;
  }
  const controlIndex = parentElement.children.findIndex(
    (childNode) => childNode === controlElement,
  );
  if (controlIndex < 0) return false;
  return parentElement.children.slice(controlIndex + 1).some((siblingNode) => {
    if (!isNodeOfType(siblingNode, "JSXElement")) return false;
    const siblingClassName = getStringFromClassNameAttr(siblingNode.openingElement);
    return Boolean(
      siblingClassName &&
      hasVariantUtility(
        siblingClassName.split(/\s+/).filter(Boolean),
        PEER_FOCUS_VARIANTS,
        isVisibleFocusIndicatorUtility,
      ),
    );
  });
};

const hasAncestorFocusIndicator = (node: EsTreeNode): boolean => {
  let currentNode = node.parent?.parent;
  while (currentNode) {
    if (isNodeOfType(currentNode, "JSXElement")) {
      const classNameValue = getStringFromClassNameAttr(currentNode.openingElement);
      if (
        classNameValue &&
        hasVariantUtility(
          classNameValue.split(/\s+/).filter(Boolean),
          ANCESTOR_FOCUS_VARIANTS,
          isVisibleFocusIndicatorUtility,
        )
      ) {
        return true;
      }
    }
    currentNode = currentNode.parent;
  }
  return false;
};

export const noInvisibleFocusControl = defineRule({
  id: "no-invisible-focus-control",
  title: "Invisible native control lacks keyboard focus treatment",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise", "react-jsx-only"],
  requires: ["tailwind"],
  category: "Accessibility",
  recommendation:
    "Reveal the native control on focus or add a visible focus-within ring to the proxy surface around it.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      const tagName = node.name.name.toLowerCase();
      if (!isFocusableJsxOpeningElement(node, tagName)) return;
      if (hasJsxSpreadAttribute(node.attributes)) return;
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      const tokens = getUnvariantClassNameTokens(classNameValue);
      const allTokens = classNameValue.split(/\s+/).filter(Boolean);
      const hasUnrestoredOpacity =
        getLastMatchingToken(tokens, (utility) => utility.startsWith("opacity-")) === "opacity-0" &&
        !hasVariantUtility(allTokens, REVEAL_VARIANTS, isVisibleOpacityUtility);
      const hasUnrestoredVisibility =
        getLastMatchingToken(
          tokens,
          (utility) => utility === "visible" || utility === "invisible" || utility === "collapse",
        ) === "invisible" &&
        !hasVariantUtility(allTokens, REVEAL_VARIANTS, (utility) => utility === "visible");
      if (!hasUnrestoredOpacity && !hasUnrestoredVisibility) return;
      if (hasAncestorFocusIndicator(node)) return;
      if (hasLaterPeerFocusIndicator(node, tokens)) return;
      context.report({
        node,
        message:
          "This native control is fully transparent, but neither it nor its proxy surface shows keyboard focus.",
      });
    },
  }),
});
