import { ROOT_FONT_SIZE_PX } from "../../../constants/design.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getUnvariantClassNameTokensWithImportantModifiers } from "../../../utils/get-unvariant-class-name-tokens-with-important-modifiers.js";
import { hasJsxSpreadAttribute } from "../../../utils/has-jsx-spread-attribute.js";
import { getEffectiveStyleProperty } from "./get-effective-style-property.js";
import { getInlineStyleExpression } from "./get-inline-style-expression.js";
import { getStaticTailwindFontSize } from "./get-static-tailwind-font-size.js";
import { getStringFromClassNameAttr } from "./get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "./get-style-property-key.js";
import { getStylePropertyNumberValue } from "./get-style-property-number-value.js";
import { getStylePropertyStringValue } from "./get-style-property-string-value.js";
import { parseStaticTailwindFontSize } from "./parse-static-tailwind-font-size.js";

const hasImportantTailwindFontSize = (classNameValue: string): boolean =>
  getUnvariantClassNameTokensWithImportantModifiers(classNameValue).some(
    (token) => token.startsWith("!") && parseStaticTailwindFontSize(token.slice(1)) !== null,
  );

const getFontSizePx = (property: EsTreeNode): number | null => {
  const numberValue = getStylePropertyNumberValue(property);
  if (numberValue !== null) return numberValue;
  const stringValue = getStylePropertyStringValue(property)?.trim();
  if (!stringValue) return null;
  const match = stringValue.match(/^((?:\d+(?:\.\d*)?|\.\d+))(px|rem)$/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  return match[2] === "rem" ? value * ROOT_FONT_SIZE_PX : value;
};

export const getStaticEffectiveFontSize = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  hasTailwind: boolean,
): number | null => {
  const classNameValue = getStringFromClassNameAttr(openingElement);
  const tailwindFontSize = hasTailwind ? getStaticTailwindFontSize(classNameValue) : null;
  if (classNameValue && hasTailwind && hasImportantTailwindFontSize(classNameValue)) {
    return tailwindFontSize;
  }

  const styleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes ?? [], "style");
  if (!styleAttribute) {
    return hasJsxSpreadAttribute(openingElement.attributes) ? null : tailwindFontSize;
  }
  const styleExpression = getInlineStyleExpression(styleAttribute);
  if (!styleExpression) return null;
  const fontSizeProperty = getEffectiveStyleProperty(styleExpression.properties, "fontSize");
  if (fontSizeProperty) return getFontSizePx(fontSizeProperty);
  return styleExpression.properties?.every((property) => getStylePropertyKey(property) !== null)
    ? tailwindFontSize
    : null;
};
