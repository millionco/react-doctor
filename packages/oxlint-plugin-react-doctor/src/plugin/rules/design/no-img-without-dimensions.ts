import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const hasReservedClassBox = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const className = getStringFromClassNameAttr(node);
  if (!className) return false;
  const tokens = getUnvariantClassNameTokens(className);
  if (tokens.some((token) => token.startsWith("aspect-"))) return true;
  if (tokens.some((token) => token.startsWith("size-"))) return true;
  return (
    tokens.some((token) => token.startsWith("w-")) && tokens.some((token) => token.startsWith("h-"))
  );
};

const hasClassNameAttribute = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean =>
  Boolean(findJsxAttribute(node.attributes, "className"));

const hasReservedInlineBox = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const styleAttribute = findJsxAttribute(node.attributes, "style");
  const expression = styleAttribute ? getInlineStyleExpression(styleAttribute) : null;
  if (!expression) return false;
  if (getEffectiveStyleProperty(expression.properties, "aspectRatio")) return true;
  return Boolean(
    getEffectiveStyleProperty(expression.properties, "width") &&
    getEffectiveStyleProperty(expression.properties, "height"),
  );
};

const hasUnresolvedInlineBox = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const styleAttribute = findJsxAttribute(node.attributes, "style");
  return Boolean(styleAttribute && !getInlineStyleExpression(styleAttribute));
};

const hasReservedParentBox = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const element = node.parent;
  const parentElement = element?.parent;
  return Boolean(
    isNodeOfType(element, "JSXElement") &&
    isNodeOfType(parentElement, "JSXElement") &&
    hasReservedClassBox(parentElement.openingElement),
  );
};

const hasUnresolvedParentBox = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const element = node.parent;
  const parentElement = element?.parent;
  if (!isNodeOfType(element, "JSXElement") || !isNodeOfType(parentElement, "JSXElement")) {
    return false;
  }
  return (
    hasClassNameAttribute(parentElement.openingElement) ||
    hasUnresolvedInlineBox(parentElement.openingElement)
  );
};

export const noImgWithoutDimensions = defineRule({
  id: "no-img-without-dimensions",
  title: "Image has no reserved layout space",
  severity: "warn",
  category: "Performance",
  defaultEnabled: false,
  recommendation:
    "Add width and height attributes, or reserve the image's aspect ratio with an explicit CSS box before it loads.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (resolveJsxElementType(node) !== "img" || hasJsxSpreadAttribute(node.attributes)) return;
      if (findJsxAttribute(node.attributes, "width") && findJsxAttribute(node.attributes, "height"))
        return;
      if (hasReservedClassBox(node) || hasReservedInlineBox(node) || hasReservedParentBox(node))
        return;
      if (
        hasClassNameAttribute(node) ||
        hasUnresolvedInlineBox(node) ||
        hasUnresolvedParentBox(node)
      ) {
        return;
      }
      context.report({
        node,
        message:
          "This image reserves no dimensions or aspect ratio before loading, so surrounding content can shift. Add width and height or an explicit aspect-ratio box.",
      });
    },
  }),
});
