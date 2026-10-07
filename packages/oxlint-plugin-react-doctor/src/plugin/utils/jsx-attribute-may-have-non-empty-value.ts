import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { getStringLiteralAttributeValue } from "./get-string-literal-attribute-value.js";
import { isLiteralVoidExpression } from "./is-literal-void-expression.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface JsxAttributeNonEmptyValueOptions {
  booleanValuesRender?: boolean;
  scopes?: ScopeAnalysis;
}

export const jsxAttributeMayHaveNonEmptyValue = (
  attribute: EsTreeNodeOfType<"JSXAttribute"> | null | undefined,
  options: JsxAttributeNonEmptyValueOptions = {},
): boolean => {
  if (!attribute?.value) return false;
  const staticStringValue = getStringLiteralAttributeValue(attribute);
  if (staticStringValue !== null) return staticStringValue.trim().length > 0;
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return true;
  const expression = stripParenExpression(attribute.value.expression);
  if (isNodeOfType(expression, "Literal")) {
    return (
      (typeof expression.value === "boolean" && options.booleanValuesRender === true) ||
      typeof expression.value === "number" ||
      (typeof expression.value === "string" && expression.value.trim().length > 0)
    );
  }
  if (
    isNodeOfType(expression, "Identifier") &&
    expression.name === "undefined" &&
    options.scopes?.isGlobalReference(expression)
  ) {
    return false;
  }
  return !isLiteralVoidExpression(expression);
};
