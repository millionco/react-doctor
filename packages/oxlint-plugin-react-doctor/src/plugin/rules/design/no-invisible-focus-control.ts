import { defineRule } from "../../utils/define-rule.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isFocusableJsxOpeningElement } from "../../utils/is-focusable-jsx-opening-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveTailwindClassNameToken } from "./utils/get-effective-tailwind-class-name-token.js";
import { getStaticTailwindOpacity } from "./utils/get-static-tailwind-opacity.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const REVEAL_VARIANTS = new Set(["focus", "focus-visible"]);
const ANCESTOR_FOCUS_VARIANTS = new Set(["focus-within", "group-focus-within"]);
const PEER_FOCUS_VARIANTS = new Set(["peer-focus", "peer-focus-visible"]);

const isVisibleOpacityUtility = (utility: string): boolean => {
  const opacity = getStaticTailwindOpacity(utility);
  return opacity !== null && opacity > 0;
};

const isVisibleFocusIndicatorUtility = (utility: string): boolean => {
  const indicatorMatch = utility.match(/^(border|outline|ring)(?:-(.+))?$/);
  if (!indicatorMatch) return false;
  const modifier = indicatorMatch[2];
  if (!modifier) return true;
  if (/^(?:0|none|transparent)(?:$|[-/])/.test(modifier)) return false;
  return !/^(?:offset|opacity|spacing)(?:$|-)/.test(modifier);
};

const hasEffectiveVariantUtility = (
  tokens: string[],
  variants: Set<string>,
  getFamily: (utility: string) => string | null,
  isAddingUtility: (utility: string) => boolean,
): boolean => {
  const normalizedUtilitiesByScopeAndFamily = new Map<string, string[]>();
  for (const token of tokens) {
    const parsedToken = parseTailwindClassNameToken(token);
    if (!parsedToken.variants.some((variant) => variants.has(variant.split("/")[0] ?? variant))) {
      continue;
    }
    const family = getFamily(parsedToken.utility);
    if (!family) continue;
    const scopeAndFamily = `${[...parsedToken.variants].sort().join(":")}|${family}`;
    const normalizedUtilities = normalizedUtilitiesByScopeAndFamily.get(scopeAndFamily) ?? [];
    normalizedUtilities.push(
      `${parsedToken.isImportant ? "!" : ""}${family}-${isAddingUtility(parsedToken.utility) ? "add" : "remove"}`,
    );
    normalizedUtilitiesByScopeAndFamily.set(scopeAndFamily, normalizedUtilities);
  }
  return [...normalizedUtilitiesByScopeAndFamily.values()].some(
    (normalizedUtilities) =>
      getEffectiveTailwindClassNameToken(normalizedUtilities, () => true)?.endsWith("-add") ===
      true,
  );
};

const getFocusIndicatorFamily = (utility: string): string | null => {
  const indicatorMatch = utility.match(/^(border|outline|ring)(?:-(.+))?$/);
  if (!indicatorMatch) return null;
  const modifier = indicatorMatch[2];
  if (modifier && /^(?:offset|opacity|spacing)(?:$|-)/.test(modifier)) return null;
  return indicatorMatch[1];
};

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
      hasEffectiveVariantUtility(
        splitTailwindClassName(siblingClassName),
        PEER_FOCUS_VARIANTS,
        getFocusIndicatorFamily,
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
        hasEffectiveVariantUtility(
          splitTailwindClassName(classNameValue),
          ANCESTOR_FOCUS_VARIANTS,
          getFocusIndicatorFamily,
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
      const allTokens = splitTailwindClassName(classNameValue);
      const effectiveOpacity = getEffectiveTailwindClassNameToken(
        allTokens,
        (utility) => getStaticTailwindOpacity(utility) !== null,
      );
      const hasUnrestoredOpacity =
        effectiveOpacity !== null &&
        getStaticTailwindOpacity(effectiveOpacity) === 0 &&
        !hasEffectiveVariantUtility(
          allTokens,
          REVEAL_VARIANTS,
          (utility) => (getStaticTailwindOpacity(utility) !== null ? "opacity" : null),
          isVisibleOpacityUtility,
        );
      const hasUnrestoredVisibility =
        getEffectiveTailwindClassNameToken(
          allTokens,
          (utility) => utility === "visible" || utility === "invisible" || utility === "collapse",
        ) === "invisible" &&
        !hasEffectiveVariantUtility(
          allTokens,
          REVEAL_VARIANTS,
          (utility) =>
            utility === "visible" || utility === "invisible" || utility === "collapse"
              ? "visibility"
              : null,
          (utility) => utility === "visible",
        );
      if (!hasUnrestoredOpacity && !hasUnrestoredVisibility) return;
      if (hasAncestorFocusIndicator(node)) return;
      if (hasLaterPeerFocusIndicator(node, allTokens)) return;
      context.report({
        node,
        message:
          "This native control is fully transparent, but neither it nor its proxy surface shows keyboard focus.",
      });
    },
  }),
});
