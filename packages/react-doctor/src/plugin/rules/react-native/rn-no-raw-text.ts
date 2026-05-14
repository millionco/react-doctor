import {
  RAW_TEXT_PREVIEW_MAX_CHARS,
  REACT_NATIVE_TEXT_COMPONENTS,
  REACT_NATIVE_TEXT_COMPONENT_KEYWORDS,
} from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import { hasDirective } from "../../utils/has-directive.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "./utils/resolve-jsx-element-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const truncateText = (text: string): string =>
  text.length > RAW_TEXT_PREVIEW_MAX_CHARS
    ? `${text.slice(0, RAW_TEXT_PREVIEW_MAX_CHARS)}...`
    : text;

const isRawTextContent = (child: EsTreeNode): boolean => {
  if (isNodeOfType(child, "JSXText")) return Boolean(child.value?.trim());
  if (!isNodeOfType(child, "JSXExpressionContainer") || !child.expression) return false;

  const expression = child.expression;
  return (
    (isNodeOfType(expression, "Literal") &&
      (typeof expression.value === "string" || typeof expression.value === "number")) ||
    isNodeOfType(expression, "TemplateLiteral")
  );
};

const getRawTextDescription = (child: EsTreeNode): string => {
  if (isNodeOfType(child, "JSXText")) {
    return `"${truncateText(child.value.trim())}"`;
  }

  if (isNodeOfType(child, "JSXExpressionContainer") && child.expression) {
    const expression = child.expression;
    if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
      return `"${truncateText(expression.value)}"`;
    }
    if (isNodeOfType(expression, "Literal") && typeof expression.value === "number") {
      return `{${expression.value}}`;
    }
    if (isNodeOfType(expression, "TemplateLiteral")) return "template literal";
  }

  return "text content";
};

const isTextHandlingComponent = (elementName: string): boolean => {
  if (REACT_NATIVE_TEXT_COMPONENTS.has(elementName)) return true;
  return [...REACT_NATIVE_TEXT_COMPONENT_KEYWORDS].some((keyword) => elementName.includes(keyword));
};

const WEB_FILE_EXTENSION_PATTERN = /\.web\.[jt]sx?$/;

export const rnNoRawText = defineRule<Rule>({
  framework: "react-native",
  severity: "error",
  category: "React Native",
  recommendation:
    "Wrap text in a `<Text>` component: `<Text>{value}</Text>` — raw strings outside `<Text>` crash on React Native",
  create: (context: RuleContext) => {
    let isWebOnlyFile = false;
    let isDomComponentFile = false;

    return {
      Program(programNode: EsTreeNode) {
        isDomComponentFile = hasDirective(programNode, "use dom");
        const filename = context.getFilename?.() ?? "";
        isWebOnlyFile = WEB_FILE_EXTENSION_PATTERN.test(filename);
      },
      JSXElement(node: EsTreeNode) {
        if (isDomComponentFile || isWebOnlyFile) return;

        const elementName = resolveJsxElementName(node.openingElement);
        if (elementName && isTextHandlingComponent(elementName)) return;

        for (const child of node.children ?? []) {
          if (!isRawTextContent(child)) continue;

          context.report({
            node: child,
            message: `Raw ${getRawTextDescription(child)} outside a <Text> component — this will crash on React Native`,
          });
        }
      },
    };
  },
});
