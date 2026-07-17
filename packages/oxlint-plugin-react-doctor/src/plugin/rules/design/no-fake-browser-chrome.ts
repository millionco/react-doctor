import { defineRule } from "../../utils/define-rule.js";
import { getStaticDirectJsxElements } from "../../utils/get-static-direct-jsx-elements.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const TRAFFIC_LIGHT_COLORS = ["red", "yellow", "green"];
const TRAFFIC_LIGHT_SIZE_PATTERN = /^size-(?:2|2\.5|3|3\.5|4)$/;

const isTrafficLight = (element: EsTreeNodeOfType<"JSXElement">, color: string): boolean => {
  if (getStaticJsxText(element).trim()) return false;
  const classNameValue = getStringFromClassNameAttr(element.openingElement);
  if (!classNameValue) return false;
  const tokens = getUnvariantClassNameTokens(classNameValue);
  return (
    tokens.includes("rounded-full") &&
    tokens.some((token) => TRAFFIC_LIGHT_SIZE_PATTERN.test(token)) &&
    tokens.some((token) => new RegExp(`^bg-${color}-(?:400|500|600)$`).test(token))
  );
};

const containsTrafficLightGroup = (element: EsTreeNodeOfType<"JSXElement">): boolean => {
  const directElements = getStaticDirectJsxElements(element);
  if (
    directElements.length === TRAFFIC_LIGHT_COLORS.length &&
    directElements.every((child, childIndex) =>
      isTrafficLight(child, TRAFFIC_LIGHT_COLORS[childIndex]),
    )
  ) {
    return true;
  }
  return directElements.some(containsTrafficLightGroup);
};

export const noFakeBrowserChrome = defineRule({
  id: "no-fake-browser-chrome",
  title: "Preview redraws decorative browser chrome",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Show the product screenshot directly or use a purposeful frame instead of adding imitation browser controls.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const classNameValue = getStringFromClassNameAttr(node.openingElement);
      if (!classNameValue) return;
      const tokens = getUnvariantClassNameTokens(classNameValue);
      const isFramedPreview =
        tokens.includes("overflow-hidden") &&
        tokens.some((token) => /^rounded(?:-|$)/.test(token)) &&
        tokens.some((token) => /^border(?:-|$)/.test(token));
      if (!isFramedPreview || !containsTrafficLightGroup(node)) return;
      context.report({
        node: node.openingElement,
        message:
          "This preview recreates browser traffic-light controls as decoration. Let the product image carry the demonstration without imitation chrome.",
      });
    },
  }),
});
