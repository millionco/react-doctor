import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "./get-authoritative-jsx-attribute.js";
import { hasJsxSpreadThatMayProvideAttribute } from "./has-jsx-spread-that-may-provide-attribute.js";
import { isHiddenFromScreenReader } from "./is-hidden-from-screen-reader.js";
import { isLiteralVoidExpression } from "./is-literal-void-expression.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { jsxAttributeMayHaveNonEmptyValue } from "./jsx-attribute-may-have-non-empty-value.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const elementMayProvideText = (
  element: EsTreeNodeOfType<"JSXElement">,
  settings: Readonly<Record<string, unknown>> | undefined,
  excludedOpeningElement: EsTreeNodeOfType<"JSXOpeningElement"> | undefined,
): boolean => {
  const { openingElement } = element;
  if (openingElement === excludedOpeningElement) return false;
  if (isHiddenFromScreenReader(openingElement, settings)) return false;
  if (
    isNodeOfType(openingElement.name, "JSXMemberExpression") ||
    (isNodeOfType(openingElement.name, "JSXIdentifier") &&
      openingElement.name.name[0] !== openingElement.name.name[0]?.toLowerCase())
  ) {
    return true;
  }
  const ariaLabelAttribute = getAuthoritativeJsxAttribute(
    openingElement.attributes,
    "aria-label",
    false,
  );
  if (
    jsxAttributeMayHaveNonEmptyValue(ariaLabelAttribute, { booleanValuesRender: true }) ||
    (!ariaLabelAttribute &&
      hasJsxSpreadThatMayProvideAttribute(openingElement.attributes, "aria-label"))
  ) {
    return true;
  }
  if (isNodeOfType(openingElement.name, "JSXIdentifier") && openingElement.name.name === "img") {
    const altAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "alt", false);
    return (
      jsxAttributeMayHaveNonEmptyValue(altAttribute) ||
      (!altAttribute && hasJsxSpreadThatMayProvideAttribute(openingElement.attributes, "alt"))
    );
  }
  return objectHasAccessibleChild(element, settings, excludedOpeningElement);
};

const hasAccessibleChild = (
  children: ReadonlyArray<EsTreeNode>,
  settings: Readonly<Record<string, unknown>> | undefined,
  excludedOpeningElement: EsTreeNodeOfType<"JSXOpeningElement"> | undefined,
): boolean => {
  for (const child of children) {
    if (isNodeOfType(child, "JSXText")) {
      if (child.value.trim().length > 0) return true;
      continue;
    }
    if (isNodeOfType(child, "JSXElement")) {
      if (elementMayProvideText(child, settings, excludedOpeningElement)) return true;
      continue;
    }
    if (isNodeOfType(child, "JSXFragment")) {
      if (hasAccessibleChild(child.children, settings, excludedOpeningElement)) return true;
      continue;
    }
    if (isNodeOfType(child, "JSXExpressionContainer")) {
      const expression = stripParenExpression(child.expression);
      if (isNodeOfType(expression, "JSXEmptyExpression")) continue;
      if (isNodeOfType(expression, "Literal")) {
        if (
          expression.value === null ||
          typeof expression.value === "boolean" ||
          (typeof expression.value === "string" && expression.value.trim().length === 0)
        ) {
          continue;
        }
        return true;
      }
      if (isLiteralVoidExpression(expression)) continue;
      if (isNodeOfType(expression, "Identifier") && expression.name === "undefined") continue;
      return true;
    }
  }
  return false;
};

export const objectHasAccessibleChild = (
  jsxElement: EsTreeNodeOfType<"JSXElement">,
  settings: Readonly<Record<string, unknown>> | undefined,
  excludedOpeningElement?: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  if (hasAccessibleChild(jsxElement.children, settings, excludedOpeningElement)) return true;
  const dangerouslySetInnerHtmlAttribute = getAuthoritativeJsxAttribute(
    jsxElement.openingElement.attributes,
    "dangerouslySetInnerHTML",
    false,
  );
  if (
    jsxAttributeMayHaveNonEmptyValue(dangerouslySetInnerHtmlAttribute) ||
    (!dangerouslySetInnerHtmlAttribute &&
      hasJsxSpreadThatMayProvideAttribute(
        jsxElement.openingElement.attributes,
        "dangerouslySetInnerHTML",
      ))
  ) {
    return true;
  }
  const childrenAttribute = getAuthoritativeJsxAttribute(
    jsxElement.openingElement.attributes,
    "children",
    false,
  );
  if (
    jsxAttributeMayHaveNonEmptyValue(childrenAttribute) ||
    (!childrenAttribute &&
      hasJsxSpreadThatMayProvideAttribute(jsxElement.openingElement.attributes, "children"))
  ) {
    return true;
  }
  return false;
};
