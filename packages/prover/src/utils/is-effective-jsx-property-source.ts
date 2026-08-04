import ts from "typescript";
import { collectJsxSpreadProperties } from "./collect-jsx-spread-properties.js";

export const isEffectiveJsxPropertySource = (
  attribute: ts.JsxAttributeLike,
  propertyName: string,
  typeChecker: ts.TypeChecker,
): boolean => {
  const attributeIndex = attribute.parent.properties.indexOf(attribute);
  for (const laterAttribute of attribute.parent.properties.slice(attributeIndex + 1)) {
    if (ts.isJsxAttribute(laterAttribute) && laterAttribute.name.getText() === propertyName) {
      return false;
    }
    if (ts.isJsxSpreadAttribute(laterAttribute)) {
      const spreadProperties = collectJsxSpreadProperties(laterAttribute.expression, typeChecker);
      if (
        spreadProperties.hasUnknownProperties ||
        spreadProperties.propertyNames.includes(propertyName)
      ) {
        return false;
      }
    }
  }
  return true;
};
