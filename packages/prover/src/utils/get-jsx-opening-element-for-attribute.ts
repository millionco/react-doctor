import ts from "typescript";

export const getJsxOpeningElementForAttribute = (
  attribute: ts.JsxAttribute,
): ts.JsxOpeningLikeElement | null => {
  const openingElement = attribute.parent.parent;
  return ts.isJsxOpeningElement(openingElement) || ts.isJsxSelfClosingElement(openingElement)
    ? openingElement
    : null;
};
