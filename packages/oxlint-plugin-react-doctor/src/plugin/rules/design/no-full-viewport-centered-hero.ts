import { CENTERED_HERO_MAX_STATIC_ELEMENTS } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxDescendantOpeningElements } from "../../utils/get-static-jsx-descendant-opening-elements.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const HERO_CONTAINER_NAMES = new Set(["header", "section"]);
const FULL_VIEWPORT_HEIGHT_TOKENS = new Set(["h-dvh", "h-screen", "min-h-dvh", "min-h-screen"]);
const ERROR_SURFACE_PATH_PATTERN = /(?:^|[/._-])(?:404|not[-_.]?found)(?:[/._-]|$)/i;

const hasCenteredLayout = (tokens: string[]): boolean =>
  (tokens.includes("flex") &&
    tokens.includes("items-center") &&
    tokens.includes("justify-center")) ||
  (tokens.includes("grid") &&
    (tokens.includes("place-items-center") ||
      (tokens.includes("items-center") && tokens.includes("justify-center"))));

export const noFullViewportCenteredHero = defineRule({
  id: "no-full-viewport-centered-hero",
  title: "Hero uses a full-viewport centered template",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Give the opening section a content-driven height and a composition tied to the product instead of centering a headline in an empty viewport.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (context.filename && ERROR_SURFACE_PATH_PATTERN.test(context.filename)) return;
      if (
        !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
        !HERO_CONTAINER_NAMES.has(node.openingElement.name.name)
      ) {
        return;
      }
      const classNameValue = getStringFromClassNameAttr(node.openingElement);
      if (!classNameValue) return;
      const tokens = getUnvariantClassNameTokens(classNameValue);
      if (
        !tokens.some((token) => FULL_VIEWPORT_HEIGHT_TOKENS.has(token)) ||
        !hasCenteredLayout(tokens)
      ) {
        return;
      }
      const descendants = getStaticJsxDescendantOpeningElements(node);
      if (descendants.length > CENTERED_HERO_MAX_STATIC_ELEMENTS) return;
      const hasPrimaryHeading = descendants.some(
        (openingElement) =>
          isNodeOfType(openingElement.name, "JSXIdentifier") && openingElement.name.name === "h1",
      );
      if (!hasPrimaryHeading) return;
      context.report({
        node: node.openingElement,
        message:
          "This hero fills the viewport only to center an H1, a common generic landing-page scaffold. Use content-led height and a more specific composition.",
      });
    },
  }),
});
