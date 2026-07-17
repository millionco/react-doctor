import { defineRule } from "../../utils/define-rule.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const ROOT_LAYOUT_CLASS_NAMES = new Set(["h-dvh", "h-screen", "min-h-dvh", "min-h-screen"]);
const WARM_NEUTRAL_SURFACE_CLASSES = new Set([
  "bg-amber-50",
  "bg-orange-50",
  "bg-stone-50",
  "bg-yellow-50",
]);

export const noDefaultWarmPageSurface = defineRule({
  id: "no-default-warm-page-surface",
  title: "Page defaults to a warm off-white surface",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Choose the page surface from an intentional product palette rather than a generic warm neutral default.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      const tokens = new Set(getUnvariantClassNameTokens(classNameValue));
      const isPageRoot =
        (isNodeOfType(node.name, "JSXIdentifier") && node.name.name === "main") ||
        [...ROOT_LAYOUT_CLASS_NAMES].some((token) => tokens.has(token));
      if (!isPageRoot) return;
      const warmSurface = [...WARM_NEUTRAL_SURFACE_CLASSES].find((token) => tokens.has(token));
      if (!warmSurface) return;
      context.report({
        node,
        message: `The page-wide ${warmSurface} surface reads as a default warm neutral. Use a palette choice tied to the product's visual identity.`,
      });
    },
  }),
});
