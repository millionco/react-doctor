import { REPEATED_GLASS_SURFACE_MIN_COUNT } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxOpeningElements } from "../../utils/get-static-jsx-opening-elements.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { hasVisibleTailwindBorder } from "./utils/has-visible-tailwind-fill-or-edge.js";
import { isTopLevelPageCopyRoot } from "./utils/is-top-level-page-copy-root.js";

const COMPLETE_ROUNDING_PATTERN = /^rounded(?:-(?:[2-9]xl|full|lg|md|sm|xl|xs|\[[^\]]+\]))?$/;
const TRANSLUCENT_BACKGROUND_PATTERN = /^bg-[^/\s]+\/(?:[1-9]|[1-9]\d)$/;
const TRANSLUCENT_ARBITRARY_BACKGROUND_PATTERN =
  /^bg-\[(?:hsla|rgba)\([^\]]+[,/]\s*(?:0?\.\d+|\d+%)\)\]$/i;

const isGlassSurface = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const classNameValue = getStringFromClassNameAttr(openingElement);
  if (!classNameValue) return false;
  const tokens = getUnvariantClassNameTokens(classNameValue);
  const hasBackdropBlur = tokens.some(
    (token) =>
      token.startsWith("backdrop-blur") &&
      token !== "backdrop-blur-0" &&
      token !== "backdrop-blur-none",
  );
  const hasTranslucentBackground = tokens.some(
    (token) =>
      TRANSLUCENT_BACKGROUND_PATTERN.test(token) ||
      TRANSLUCENT_ARBITRARY_BACKGROUND_PATTERN.test(token),
  );
  const hasRounding =
    !tokens.includes("rounded-none") &&
    tokens.some((token) => COMPLETE_ROUNDING_PATTERN.test(token));
  return (
    hasBackdropBlur && hasTranslucentBackground && hasRounding && hasVisibleTailwindBorder(tokens)
  );
};

export const noRepeatedGlassSurfaces = defineRule({
  id: "no-repeated-glass-surfaces",
  title: "Page repeats glass panels",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Reserve translucency for one overlay or focal layer and use quieter opaque surfaces elsewhere.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!isTopLevelPageCopyRoot(node)) return;
      const glassSurfaceCount = getStaticJsxOpeningElements(node).filter(isGlassSurface).length;
      if (glassSurfaceCount < REPEATED_GLASS_SURFACE_MIN_COUNT) return;
      context.report({
        node: node.openingElement,
        message: `This page applies the same translucent, blurred, bordered treatment to ${glassSurfaceCount} surfaces. Keep glass effects rare so the hierarchy stays clear.`,
      });
    },
  }),
});
