import { REPEATED_SECTION_SHELL_MIN_COUNT } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticDirectJsxElements } from "../../utils/get-static-direct-jsx-elements.js";
import { getStaticJsxOpeningElements } from "../../utils/get-static-jsx-opening-elements.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { isTopLevelPageCopyRoot } from "./utils/is-top-level-page-copy-root.js";

const LARGE_VERTICAL_PADDING_PATTERN = /^py-(?:1[2468]|2[048]|3[02])$/;

const isCenteredMaxWidthContainer = (element: EsTreeNodeOfType<"JSXElement">): boolean => {
  const classNameValue = getStringFromClassNameAttr(element.openingElement);
  if (!classNameValue) return false;
  const tokens = getUnvariantClassNameTokens(classNameValue);
  return tokens.includes("mx-auto") && tokens.some((token) => /^max-w-(?!full|none)/.test(token));
};

const isRepeatedSectionShell = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  if (
    !isNodeOfType(openingElement.name, "JSXIdentifier") ||
    openingElement.name.name !== "section"
  ) {
    return false;
  }
  const classNameValue = getStringFromClassNameAttr(openingElement);
  if (!classNameValue) return false;
  const tokens = getUnvariantClassNameTokens(classNameValue);
  if (!tokens.some((token) => LARGE_VERTICAL_PADDING_PATTERN.test(token))) return false;
  const element = openingElement.parent;
  return (
    isNodeOfType(element, "JSXElement") &&
    getStaticDirectJsxElements(element).some(isCenteredMaxWidthContainer)
  );
};

export const noRepeatedSectionShells = defineRule({
  id: "no-repeated-section-shells",
  title: "Page repeats the same padded section shell",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Vary section composition and rhythm instead of wrapping every block in the same large padding and centered max-width container.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!isTopLevelPageCopyRoot(node)) return;
      const sectionShellCount =
        getStaticJsxOpeningElements(node).filter(isRepeatedSectionShell).length;
      if (sectionShellCount < REPEATED_SECTION_SHELL_MIN_COUNT) return;
      context.report({
        node: node.openingElement,
        message: `This page repeats the same large vertical padding and centered max-width wrapper across ${sectionShellCount} sections. Vary the composition to reflect the content.`,
      });
    },
  }),
});
