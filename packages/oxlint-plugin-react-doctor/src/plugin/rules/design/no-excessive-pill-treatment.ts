import {
  EXCESSIVE_PILL_TREATMENT_MIN_COUNT,
  SHORT_DECORATIVE_LABEL_MAX_CHARACTERS,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxOpeningElements } from "../../utils/get-static-jsx-opening-elements.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { hasVisibleTailwindFillOrEdge } from "./utils/has-visible-tailwind-fill-or-edge.js";
import { isTopLevelPageCopyRoot } from "./utils/is-top-level-page-copy-root.js";

const HORIZONTAL_PADDING_PATTERN = /^px-(?:px|[\d.]+|\[[^\]]+\])$/;

const isPillTreatment = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const element = openingElement.parent;
  if (!isNodeOfType(element, "JSXElement")) return false;
  const text = getStaticJsxText(element).replace(/\s+/g, " ").trim();
  if (!text || text.length > SHORT_DECORATIVE_LABEL_MAX_CHARACTERS) return false;
  const classNameValue = getStringFromClassNameAttr(openingElement);
  if (!classNameValue) return false;
  const tokens = getUnvariantClassNameTokens(classNameValue);
  return (
    tokens.includes("rounded-full") &&
    tokens.some((token) => HORIZONTAL_PADDING_PATTERN.test(token)) &&
    hasVisibleTailwindFillOrEdge(tokens)
  );
};

export const noExcessivePillTreatment = defineRule({
  id: "no-excessive-pill-treatment",
  title: "Page overuses pill-shaped treatments",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Use pills only for controls or compact metadata whose shape communicates a real role.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!isTopLevelPageCopyRoot(node)) return;
      const pillCount = getStaticJsxOpeningElements(node).filter(isPillTreatment).length;
      if (pillCount < EXCESSIVE_PILL_TREATMENT_MIN_COUNT) return;
      context.report({
        node: node.openingElement,
        message: `This page turns ${pillCount} short labels or actions into rounded pills. Reduce the treatment so important controls and metadata remain distinct.`,
      });
    },
  }),
});
