import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxOpeningElements } from "../../utils/get-static-jsx-opening-elements.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const DOCUMENT_ROOT_ELEMENT_NAMES = new Set(["article", "main"]);
const HEADING_ELEMENT_PATTERN = /^h([1-6])$/;

const getElementName = (node: EsTreeNodeOfType<"JSXElement">): string | null =>
  isNodeOfType(node.openingElement.name, "JSXIdentifier") ? node.openingElement.name.name : null;

const hasDocumentRootAncestor = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "JSXElement") &&
      DOCUMENT_ROOT_ELEMENT_NAMES.has(getElementName(ancestor) ?? "")
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

export const noSkippedHeadingLevel = defineRule({
  id: "no-skipped-heading-level",
  title: "Heading hierarchy skips a level",
  severity: "warn",
  defaultEnabled: false,
  category: "Accessibility",
  recommendation:
    "Keep headings in a continuous hierarchy inside a page or article so assistive navigation reflects the visual structure.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const elementName = getElementName(node);
      if (!elementName || !DOCUMENT_ROOT_ELEMENT_NAMES.has(elementName)) return;
      if (hasDocumentRootAncestor(node)) return;
      const headings: Array<{
        level: number;
        node: EsTreeNodeOfType<"JSXOpeningElement">;
      }> = [];
      for (const openingElement of getStaticJsxOpeningElements(node)) {
        const headingMatch = isNodeOfType(openingElement.name, "JSXIdentifier")
          ? openingElement.name.name.match(HEADING_ELEMENT_PATTERN)
          : null;
        if (headingMatch) {
          headings.push({ level: parseInt(headingMatch[1], 10), node: openingElement });
        }
      }
      for (let headingIndex = 1; headingIndex < headings.length; headingIndex += 1) {
        const previousHeading = headings[headingIndex - 1];
        const heading = headings[headingIndex];
        if (heading.level <= previousHeading.level + 1) continue;
        context.report({
          node: heading.node,
          message: `This heading jumps from h${previousHeading.level} to h${heading.level}. Use the next level so the document outline stays coherent.`,
        });
      }
    },
  }),
});
