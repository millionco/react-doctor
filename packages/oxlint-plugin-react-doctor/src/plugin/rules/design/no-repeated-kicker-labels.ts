import {
  REPEATED_DECORATIVE_LABEL_MIN_COUNT,
  SHORT_DECORATIVE_LABEL_MAX_CHARACTERS,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getNextStaticJsxElementSibling } from "../../utils/get-next-static-jsx-element-sibling.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const HEADING_ELEMENT_PATTERN = /^h[1-6]$/;

const isShortTrackedUppercaseLabel = (node: EsTreeNodeOfType<"JSXElement">): boolean => {
  const text = getStaticJsxText(node).replace(/\s+/g, " ").trim();
  if (!text || text.length > SHORT_DECORATIVE_LABEL_MAX_CHARACTERS) return false;
  const classNameValue = getStringFromClassNameAttr(node.openingElement);
  if (!classNameValue) return false;
  const tokens = getUnvariantClassNameTokens(classNameValue);
  return tokens.includes("uppercase") && tokens.some((token) => token.startsWith("tracking-"));
};

const isFollowedByHeading = (node: EsTreeNodeOfType<"JSXElement">): boolean => {
  const sibling = getNextStaticJsxElementSibling(node);
  return Boolean(
    sibling &&
    isNodeOfType(sibling.openingElement.name, "JSXIdentifier") &&
    HEADING_ELEMENT_PATTERN.test(sibling.openingElement.name.name),
  );
};

export const noRepeatedKickerLabels = defineRule({
  id: "no-repeated-kicker-labels",
  title: "Repeated tracked labels scaffold multiple sections",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Use stronger section composition or reserve the decorative kicker treatment for one meaningful moment.",
  create: (context: RuleContext) => {
    const candidates = new Set<EsTreeNodeOfType<"JSXOpeningElement">>();
    return {
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        if (!isShortTrackedUppercaseLabel(node) || !isFollowedByHeading(node)) return;
        candidates.add(node.openingElement);
      },
      "Program:exit"() {
        if (candidates.size < REPEATED_DECORATIVE_LABEL_MIN_COUNT) return;
        const firstCandidate = candidates.values().next().value;
        if (!firstCandidate) return;
        context.report({
          node: firstCandidate,
          message:
            "The same uppercase tracked kicker repeats across several sections and makes the page feel templated. Vary the section structure.",
        });
      },
    };
  },
});
