import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getJsxPropStringValue } from "./get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "./has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseJsxValue } from "./parse-jsx-value.js";
import { splitTailwindClassName } from "./split-tailwind-class-name.js";

const ALWAYS_FOCUSABLE_TAGS: ReadonlySet<string> = new Set([
  "button",
  "embed",
  "select",
  "summary",
  "textarea",
]);
const DISABLEABLE_TAGS: ReadonlySet<string> = new Set(["button", "input", "select", "textarea"]);
const HIDING_STYLE_VALUES: Readonly<Record<string, string>> = {
  display: "none",
  visibility: "hidden",
};

const isStaticallyFalseBooleanAttribute = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
): boolean => {
  const value = attribute.value;
  if (!value || !isNodeOfType(value, "JSXExpressionContainer")) return false;
  return isNodeOfType(value.expression, "Literal") && value.expression.value === false;
};

const isNativelyFocusable = (
  tagName: string,
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  if (DISABLEABLE_TAGS.has(tagName)) {
    const disabledAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "disabled");
    if (disabledAttribute && !isStaticallyFalseBooleanAttribute(disabledAttribute)) return false;
  }
  if (ALWAYS_FOCUSABLE_TAGS.has(tagName)) return true;
  if (tagName === "input") {
    const typeAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "type");
    return (
      (typeAttribute ? getJsxPropStringValue(typeAttribute) : null)?.toLowerCase() !== "hidden"
    );
  }
  if (tagName === "a" || tagName === "area") {
    return hasJsxPropIgnoreCase(openingElement.attributes, "href") !== undefined;
  }
  if (tagName === "audio" || tagName === "video") {
    const controlsAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "controls");
    return Boolean(controlsAttribute && !isStaticallyFalseBooleanAttribute(controlsAttribute));
  }
  return false;
};

const hasStaticHidingInlineStyle = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const styleAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "style");
  if (!styleAttribute?.value || !isNodeOfType(styleAttribute.value, "JSXExpressionContainer")) {
    return false;
  }
  const expression: EsTreeNode = styleAttribute.value.expression;
  if (!isNodeOfType(expression, "ObjectExpression")) return false;
  for (const property of expression.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    const key = property.key;
    const keyName = isNodeOfType(key, "Identifier")
      ? key.name
      : isNodeOfType(key, "Literal") && typeof key.value === "string"
        ? key.value
        : null;
    if (!keyName) continue;
    const hidingValue = HIDING_STYLE_VALUES[keyName];
    if (
      hidingValue &&
      isNodeOfType(property.value, "Literal") &&
      property.value.value === hidingValue
    ) {
      return true;
    }
  }
  return false;
};

const hasHidingClassName = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const classNameAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "className");
  if (!classNameAttribute?.value) return false;
  const value = classNameAttribute.value;
  let classNameText: string | null = null;
  if (isNodeOfType(value, "Literal") && typeof value.value === "string") {
    classNameText = value.value;
  } else if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression: EsTreeNode = value.expression;
    if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
      classNameText = expression.value;
    } else if (isNodeOfType(expression, "TemplateLiteral")) {
      classNameText = expression.quasis.map((quasi) => quasi.value.cooked ?? "").join(" ");
    }
  }
  return Boolean(
    classNameText &&
    splitTailwindClassName(classNameText).some(
      (token) => token === "hidden" || token.endsWith("-hidden"),
    ),
  );
};

export const isFocusableJsxOpeningElement = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  tagName: string,
  includeNegativeTabIndex = false,
): boolean => {
  const tabIndexAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "tabIndex");
  const tabIndexValue = tabIndexAttribute ? parseJsxValue(tabIndexAttribute.value ?? null) : null;
  if (tabIndexValue !== null && tabIndexValue < 0 && !includeNegativeTabIndex) return false;
  if (hasJsxPropIgnoreCase(openingElement.attributes, "hidden")) return false;
  if (hasStaticHidingInlineStyle(openingElement) || hasHidingClassName(openingElement))
    return false;
  return Boolean(
    (tabIndexValue !== null && (tabIndexValue >= 0 || includeNegativeTabIndex)) ||
    isNativelyFocusable(tagName, openingElement),
  );
};
