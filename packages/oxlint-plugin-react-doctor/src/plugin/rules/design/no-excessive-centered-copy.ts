import { CENTERED_COPY_MIN_CHARACTERS, CENTERED_COPY_MIN_COUNT } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxOpeningElements } from "../../utils/get-static-jsx-opening-elements.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { isTopLevelPageCopyRoot } from "./utils/is-top-level-page-copy-root.js";

const isCenteredParagraph = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  if (!isNodeOfType(openingElement.name, "JSXIdentifier") || openingElement.name.name !== "p") {
    return false;
  }
  const element = openingElement.parent;
  if (!isNodeOfType(element, "JSXElement")) return false;
  const text = getStaticJsxText(element).replace(/\s+/g, " ").trim();
  if (text.length < CENTERED_COPY_MIN_CHARACTERS) return false;
  const classNameValue = getStringFromClassNameAttr(openingElement);
  return Boolean(
    classNameValue && getUnvariantClassNameTokens(classNameValue).includes("text-center"),
  );
};

export const noExcessiveCenteredCopy = defineRule({
  id: "no-excessive-centered-copy",
  title: "Page centers multiple body-copy blocks",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Keep longer body copy left-aligned and reserve centered text for one concise focal statement.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!isTopLevelPageCopyRoot(node)) return;
      const centeredParagraphCount =
        getStaticJsxOpeningElements(node).filter(isCenteredParagraph).length;
      if (centeredParagraphCount < CENTERED_COPY_MIN_COUNT) return;
      context.report({
        node: node.openingElement,
        message: `This page centers ${centeredParagraphCount} substantial paragraphs. Left-align body copy to improve scanning and keep centered composition from becoming a template default.`,
      });
    },
  }),
});
