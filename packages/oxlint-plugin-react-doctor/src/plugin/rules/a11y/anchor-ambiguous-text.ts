import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const buildMessage = (text: string): string =>
  `Screen reader users can't tell where \`${text}\` goes, so name the destination, like "View pricing details".`;

interface AnchorAmbiguousTextSettings {
  words?: ReadonlyArray<string>;
}

const DEFAULT_AMBIGUOUS: ReadonlyArray<string> = [
  "click here",
  "here",
  "link",
  "a link",
  "learn more",
];

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<AnchorAmbiguousTextSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { anchorAmbiguousText?: AnchorAmbiguousTextSettings })
          .anchorAmbiguousText ?? {})
      : {};
  return { words: ruleSettings.words ?? DEFAULT_AMBIGUOUS };
};

// Strip punctuation per OXC's `normalize_str`, then collapse internal
// whitespace into single spaces and lowercase.
const normalizeText = (text: string): string => {
  const lower = text.toLowerCase();
  const stripped = lower.replace(/[,.?¿!‽¡;:]/g, "");
  return stripped
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .join(" ");
};

const getAccessibleText = (
  element: EsTreeNodeOfType<"JSXElement">,
  settings: Readonly<Record<string, unknown>> | undefined,
): string | null => {
  const opening = element.openingElement;
  const ariaLabel = hasJsxPropIgnoreCase(opening.attributes, "aria-label");
  if (ariaLabel) {
    const labelValue = getJsxPropStringValue(ariaLabel);
    if (labelValue !== null) return labelValue;
  }
  const tag = getElementType(opening, settings);
  if (tag === "img") {
    const altAttribute = hasJsxPropIgnoreCase(opening.attributes, "alt");
    if (altAttribute) {
      const altValue = getJsxPropStringValue(altAttribute);
      if (altValue !== null) return altValue;
    }
  }
  if (isHiddenFromScreenReader(opening, settings)) return null;
  const parts: string[] = [];
  for (const child of element.children) {
    const childNode = child as EsTreeNode;
    if (isNodeOfType(childNode, "JSXText")) {
      parts.push(childNode.value);
    } else if (isNodeOfType(childNode, "JSXElement")) {
      const inner = getAccessibleText(childNode, settings);
      if (inner !== null) parts.push(inner);
    }
  }
  return parts.join(" ");
};

// Port of `oxc_linter::rules::jsx_a11y::anchor_ambiguous_text`.
export const anchorAmbiguousText = defineRule<Rule>({
  id: "anchor-ambiguous-text",
  title: "Ambiguous link text",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Name where a link goes. Avoid 'click here', 'learn more', and 'link'.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const ambiguousSet = new Set(settings.words.map((word) => word.toLowerCase()));
    return {
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        const tag = getElementType(node.openingElement, context.settings);
        if (tag !== "a") return;
        const accessibleText = getAccessibleText(node, context.settings);
        if (accessibleText === null || accessibleText.trim().length === 0) return;
        const normalized = normalizeText(accessibleText);
        if (ambiguousSet.has(normalized)) {
          context.report({
            node: node.openingElement.name,
            message: buildMessage(normalized),
          });
        }
      },
    };
  },
});
