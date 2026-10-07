import { MANUFACTURED_COPY_PATTERN_MIN_COUNT } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getReactDoctorStringSetting } from "../../utils/get-react-doctor-setting.js";
import { isInsideStaticallyHiddenJsxSubtree } from "../../utils/is-inside-statically-hidden-jsx-subtree.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementName } from "../../utils/resolve-jsx-element-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isTopLevelPageCopyRoot } from "./utils/is-top-level-page-copy-root.js";

const NOT_THEN_ASSERTION_PATTERN =
  /\bnot\s+(?:just\s+)?[^.!?]{3,60}[.!?]\s+(?:it(?:'s| is)|we|you|a|an|the)\b/gi;
const NO_JUST_PATTERN = /\bno\s+[^.!?]{2,50}[.!?]\s+just\s+[^.!?]{2,60}(?:[.!?]|$)/gi;
const ASSERTION_THEN_RESTRICTION_PATTERN =
  /\b[^.!?]{3,60}\.\s+(?:no|just)\s+[^.!?]{2,60}(?:[.!?]|$)/gi;
const LONG_FORM_CONTENT_PATH_PATTERN =
  /(?:^|[/\\])(?:blog|changelog|content|docs?|documentation|posts?)(?:[/\\]|$)/i;
const EXCLUDED_INTRINSIC_COPY_ELEMENT_NAMES = new Set(["code", "kbd", "pre", "samp"]);
const EXCLUDED_COPY_COMPONENT_NAME_PATTERN = /(?:Code|Console|Markdown|MDX|Mdx|Terminal)/;
const STATIC_COPY_BOUNDARY = "?!";
const CONTRAST_COPY_PATTERNS = [
  NOT_THEN_ASSERTION_PATTERN,
  NO_JUST_PATTERN,
  ASSERTION_THEN_RESTRICTION_PATTERN,
];

const isExcludedCopyElement = (node: EsTreeNodeOfType<"JSXElement">): boolean => {
  const elementName = resolveJsxElementName(node.openingElement);
  if (!elementName) return false;
  return (
    EXCLUDED_INTRINSIC_COPY_ELEMENT_NAMES.has(elementName.toLowerCase()) ||
    EXCLUDED_COPY_COMPONENT_NAME_PATTERN.test(elementName)
  );
};

const getStaticCopyText = (
  node: EsTreeNode | null | undefined,
  context: RuleContext,
): string | null => {
  if (!node) return null;
  if (isNodeOfType(node, "JSXText")) return node.value ?? "";
  if (isNodeOfType(node, "JSXEmptyExpression")) return "";
  if (isNodeOfType(node, "Literal")) {
    if (typeof node.value === "string") return node.value;
    if (node.value === null || typeof node.value === "boolean") return "";
    return STATIC_COPY_BOUNDARY;
  }
  if (isNodeOfType(node, "TemplateLiteral")) {
    return node.expressions.length === 0
      ? (node.quasis ?? []).map((quasi) => quasi.value?.raw ?? "").join("")
      : null;
  }
  if (isNodeOfType(node, "JSXExpressionContainer")) {
    return getStaticCopyText(node.expression, context);
  }
  if (isNodeOfType(node, "JSXElement") || isNodeOfType(node, "JSXFragment")) {
    if (
      isNodeOfType(node, "JSXElement") &&
      (isExcludedCopyElement(node) || isInsideStaticallyHiddenJsxSubtree(node, context))
    ) {
      return STATIC_COPY_BOUNDARY;
    }
    const childTexts: string[] = [];
    for (const child of node.children ?? []) {
      const childText = getStaticCopyText(child, context);
      if (childText === null) return null;
      childTexts.push(childText);
    }
    return childTexts.join(" ");
  }
  return null;
};

const isInsideExcludedCopyContext = (
  node: EsTreeNodeOfType<"JSXElement">,
  context: RuleContext,
): boolean => {
  if (isInsideStaticallyHiddenJsxSubtree(node, context)) return true;
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement") && isExcludedCopyElement(ancestor)) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const countNonOverlappingPatternRanges = (text: string): number => {
  const ranges = CONTRAST_COPY_PATTERNS.flatMap((pattern) =>
    [...text.matchAll(pattern)].flatMap((match) =>
      match.index === undefined
        ? []
        : [
            {
              start: match.index,
              end: match.index + match[0].length,
            },
          ],
    ),
  ).sort((leftRange, rightRange) => leftRange.start - rightRange.start);

  let patternCount = 0;
  let previousRangeEnd: number | null = null;
  for (const range of ranges) {
    if (previousRangeEnd !== null && range.start < previousRangeEnd) continue;
    patternCount += 1;
    previousRangeEnd = range.end;
  }
  return patternCount;
};

const isLongFormContentPath = (context: RuleContext): boolean => {
  const rootDirectory = getReactDoctorStringSetting(context.settings, "rootDirectory") ?? "";
  return LONG_FORM_CONTENT_PATH_PATTERN.test(`${rootDirectory}/${context.filename ?? ""}`);
};

export const noManufacturedContrastCopy = defineRule({
  id: "no-manufactured-contrast-copy",
  title: "Page repeatedly uses manufactured contrast copy",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "State the value directly instead of repeatedly contrasting it with a vague alternative.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        isLongFormContentPath(context) ||
        !isTopLevelPageCopyRoot(node) ||
        isInsideExcludedCopyContext(node, context)
      ) {
        return;
      }
      const staticCopyText = getStaticCopyText(node, context);
      if (staticCopyText === null) return;
      const pageText = staticCopyText.replace(/\s+/g, " ").trim();
      const patternCount = countNonOverlappingPatternRanges(pageText);
      if (patternCount < MANUFACTURED_COPY_PATTERN_MIN_COUNT) return;
      context.report({
        node: node.openingElement,
        message: `This page uses contrast-first sentence patterns ${patternCount} times. Rewrite the claims as direct, concrete statements.`,
      });
    },
  }),
});
