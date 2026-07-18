import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getJsxPropStaticStringValues } from "../../utils/get-jsx-prop-static-string-values.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isFocusableJsxOpeningElement } from "../../utils/is-focusable-jsx-opening-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

const SUPPORTED_CONTROL_TAG_NAMES: ReadonlySet<string> = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
]);

const POTENTIALLY_DISABLING_ATTRIBUTE_NAMES: ReadonlyArray<string> = [
  "aria-disabled",
  "disabled",
  "hidden",
  "inert",
];

const hasPotentiallyDisablingAttribute = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean =>
  POTENTIALLY_DISABLING_ATTRIBUTE_NAMES.some((attributeName) =>
    Boolean(hasJsxPropIgnoreCase(node.attributes, attributeName)),
  );

const isProvablyNonHiddenInput = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  const typeAttribute = hasJsxPropIgnoreCase(node.attributes, "type");
  if (!typeAttribute) return true;
  const typeValues = getJsxPropStaticStringValues(typeAttribute, context.scopes);
  return Boolean(
    typeValues && typeValues.every((typeValue) => typeValue.toLowerCase() !== "hidden"),
  );
};

const getStaticClassName = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): string | null | undefined => {
  const classNameAttribute = findJsxAttribute(node.attributes, "className");
  if (!classNameAttribute) return undefined;
  return getStringFromClassNameAttr(node);
};

const getStaticStyleExpression = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): EsTreeNodeOfType<"ObjectExpression"> | null | undefined => {
  const styleAttribute = findJsxAttribute(node.attributes, "style");
  if (!styleAttribute) return undefined;
  const expression = getInlineStyleExpression(styleAttribute);
  if (!expression) return null;
  if (
    expression.properties.some(
      (property) => !isNodeOfType(property, "Property") || getStylePropertyKey(property) === null,
    )
  ) {
    return null;
  }
  return expression;
};

export const noPointerDisabledEnabledControl = defineRule({
  id: "no-pointer-disabled-enabled-control",
  title: "Enabled control ignores pointer input",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Remove `pointer-events: none` from enabled controls so mouse and touch users can operate them, or mark the control unavailable with native disabled semantics.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      const tagName = node.name.name;
      if (!SUPPORTED_CONTROL_TAG_NAMES.has(tagName) || hasJsxSpreadAttribute(node.attributes)) {
        return;
      }
      if (hasPotentiallyDisablingAttribute(node)) return;
      if (tagName === "input" && !isProvablyNonHiddenInput(node, context)) return;
      if (!isFocusableJsxOpeningElement(node, tagName)) return;

      const className = getStaticClassName(node);
      const styleExpression = getStaticStyleExpression(node);
      if (className === null || styleExpression === null) return;

      const hasPointerDisabledClass = Boolean(
        className && getUnvariantClassNameTokens(className).includes("pointer-events-none"),
      );
      const pointerEventsProperty = styleExpression
        ? getEffectiveStyleProperty(styleExpression.properties, "pointerEvents")
        : null;
      let hasPointerDisabled = hasPointerDisabledClass;
      if (pointerEventsProperty) {
        const pointerEventsValue = getStylePropertyStringValue(pointerEventsProperty);
        if (pointerEventsValue === null) return;
        hasPointerDisabled = pointerEventsValue === "none";
      }
      if (!hasPointerDisabled) return;

      const reportNode: EsTreeNode =
        pointerEventsProperty ?? findJsxAttribute(node.attributes, "className") ?? node;
      context.report({
        node: reportNode,
        message:
          "This enabled control disables pointer events, so mouse and touch users cannot operate it. Remove `pointer-events: none` or mark the control unavailable.",
      });
    },
  }),
});
