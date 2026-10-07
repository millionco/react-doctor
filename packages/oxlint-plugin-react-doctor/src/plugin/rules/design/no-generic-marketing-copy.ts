import { GENERIC_MARKETING_PHRASES } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isInsideStaticallyHiddenJsxSubtree } from "../../utils/is-inside-statically-hidden-jsx-subtree.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isTopLevelPageCopyRoot } from "./utils/is-top-level-page-copy-root.js";

const MARKETING_COPY_EXCLUDED_ELEMENT_NAMES = new Set([
  "code",
  "codeblock",
  "codesnippet",
  "demo",
  "example",
  "fixture",
  "kbd",
  "markdown",
  "markdownblock",
  "markdowncontent",
  "markdownrenderer",
  "markdowntext",
  "markdownview",
  "mdx",
  "mdxcontent",
  "mdxremote",
  "playground",
  "pre",
  "preview",
  "reactmarkdown",
  "renderproxy",
  "samp",
  "script",
  "story",
  "style",
  "syntaxhighlighter",
  "template",
]);
const STATIC_COPY_BOUNDARY = "\0";
const LEXICAL_CHARACTER_PATTERN = /[\p{L}\p{N}]/u;

const isExcludedCopyElement = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const elementName = resolveJsxElementType(openingElement).split(".").at(-1);
  return Boolean(
    elementName && MARKETING_COPY_EXCLUDED_ELEMENT_NAMES.has(elementName.toLowerCase()),
  );
};

const getStaticRenderedCopy = (
  node: EsTreeNode | null | undefined,
  context: RuleContext,
): string => {
  if (!node) return "";
  if (isNodeOfType(node, "JSXText")) return node.value ?? "";
  if (isNodeOfType(node, "JSXEmptyExpression")) return "";
  if (isNodeOfType(node, "Literal")) {
    return typeof node.value === "string" ? node.value : "";
  }
  if (isNodeOfType(node, "TemplateLiteral")) {
    const staticSegments = (node.quasis ?? []).map((quasi) => quasi.value?.raw ?? "");
    if (node.expressions.length === 0) return staticSegments.join("");
    return `${STATIC_COPY_BOUNDARY}${staticSegments.join(STATIC_COPY_BOUNDARY)}${STATIC_COPY_BOUNDARY}`;
  }
  if (isNodeOfType(node, "JSXExpressionContainer")) {
    return getStaticRenderedCopy(node.expression, context);
  }
  if (isNodeOfType(node, "JSXElement")) {
    if (
      isExcludedCopyElement(node.openingElement) ||
      isInsideStaticallyHiddenJsxSubtree(node, context)
    ) {
      return "";
    }
    return (node.children ?? []).map((child) => getStaticRenderedCopy(child, context)).join(" ");
  }
  if (isNodeOfType(node, "JSXFragment")) {
    return (node.children ?? []).map((child) => getStaticRenderedCopy(child, context)).join(" ");
  }
  if (isNodeOfType(node, "ConditionalExpression")) {
    return `${STATIC_COPY_BOUNDARY}${getStaticRenderedCopy(
      node.consequent,
      context,
    )}${STATIC_COPY_BOUNDARY}${getStaticRenderedCopy(
      node.alternate,
      context,
    )}${STATIC_COPY_BOUNDARY}`;
  }
  if (isNodeOfType(node, "LogicalExpression")) {
    return `${STATIC_COPY_BOUNDARY}${getStaticRenderedCopy(
      node.right,
      context,
    )}${STATIC_COPY_BOUNDARY}`;
  }
  return STATIC_COPY_BOUNDARY;
};

const isInsideExcludedCopyElement = (node: EsTreeNodeOfType<"JSXElement">): boolean => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement") && isExcludedCopyElement(ancestor.openingElement)) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const findFirstMarketingPhrase = (pageText: string): string | null => {
  let firstPhrase: string | null = null;
  let firstPhraseIndex = pageText.length;
  for (const phrase of GENERIC_MARKETING_PHRASES) {
    let searchStartIndex = 0;
    while (searchStartIndex < pageText.length) {
      const phraseIndex = pageText.indexOf(phrase, searchStartIndex);
      if (phraseIndex < 0 || phraseIndex >= firstPhraseIndex) break;
      const precedingCharacter = pageText[phraseIndex - 1];
      const followingCharacter = pageText[phraseIndex + phrase.length];
      if (
        (!precedingCharacter || !LEXICAL_CHARACTER_PATTERN.test(precedingCharacter)) &&
        (!followingCharacter || !LEXICAL_CHARACTER_PATTERN.test(followingCharacter))
      ) {
        firstPhrase = phrase;
        firstPhraseIndex = phraseIndex;
        break;
      }
      searchStartIndex = phraseIndex + phrase.length;
    }
  }
  return firstPhrase;
};

export const noGenericMarketingCopy = defineRule({
  id: "no-generic-marketing-copy",
  title: "Page uses generic marketing language",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Replace broad promotional phrases with concrete capabilities, outcomes, or evidence.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!isTopLevelPageCopyRoot(node) || isInsideExcludedCopyElement(node)) return;
      const pageText = getStaticRenderedCopy(node, context).replace(/\s+/g, " ").toLowerCase();
      const matchedPhrase = findFirstMarketingPhrase(pageText);
      if (!matchedPhrase) return;
      context.report({
        node: node.openingElement,
        message: `The phrase “${matchedPhrase}” makes a broad promise without saying what the product actually does. Use specific copy.`,
      });
    },
  }),
});
