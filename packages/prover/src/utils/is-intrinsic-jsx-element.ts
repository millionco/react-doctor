import ts from "typescript";

export const isIntrinsicJsxElement = (openingElement: ts.JsxOpeningLikeElement): boolean =>
  ts.isIdentifier(openingElement.tagName) && /^[a-z]/.test(openingElement.tagName.text);
