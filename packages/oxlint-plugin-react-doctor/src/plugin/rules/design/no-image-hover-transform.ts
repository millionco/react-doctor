import {
  MOTION_IMAGE_NEUTRAL_ROTATION_DEGREES,
  MOTION_IMAGE_NEUTRAL_SCALE,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getJsxPropStaticStringValues } from "../../utils/get-jsx-prop-static-string-values.js";
import { getStaticMotionPropObject } from "../../utils/get-static-motion-prop-object.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isLiteralVoidExpression } from "../../utils/is-literal-void-expression.js";
import { isProvenFramerMotionJsxElement } from "../../utils/is-proven-framer-motion-jsx-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveJsxElementName } from "../../utils/resolve-jsx-element-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { tokenizeIdentifierWords } from "../../utils/tokenize-identifier-words.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getEffectiveTailwindClassNameToken } from "./utils/get-effective-tailwind-class-name-token.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";

const HOVER_VARIANT_PATTERN = /^(?:(?:group|peer)-)?hover(?:\/[^:]+)?$/;
const IMAGE_TRANSFORM_PATTERN = /^-?(?:scale|rotate)-/;
const NEUTRAL_SCALE_PATTERN = /^scale(?:-[xyz])?-(?:100|none|\[(?:1(?:\.0+)?|100(?:\.0+)?%)\])$/;
const NEUTRAL_ROTATE_PATTERN =
  /^rotate(?:-[xyz])?-(?:0|none|\[0(?:\.0+)?(?:deg|grad|rad|turn)?\])$/;
const MOTION_IMAGE_SCALE_PROPERTY_NAMES = ["scale", "scaleX", "scaleY"];
const MOTION_IMAGE_ROTATION_PROPERTY_NAMES = ["rotate", "rotateX", "rotateY", "rotateZ"];
const FUNCTIONAL_IMAGE_CONTEXT_PATTERN =
  /(?:^|[-_\s])(?:crop(?:per)?|gallery|image[-_\s]?viewer|lightbox|product[-_\s]?zoom|zoom)(?:$|[-_\s])/i;
const FUNCTIONAL_IMAGE_CONTEXT_IDENTIFIER_WORDS = new Set([
  "crop",
  "cropper",
  "gallery",
  "lightbox",
  "zoom",
]);
const FUNCTIONAL_IMAGE_CONTEXT_VALUE_ATTRIBUTE_NAMES = new Set([
  "aria-label",
  "aria-roledescription",
  "className",
  "data-testid",
  "id",
  "title",
]);
const INACTIVE_CONTEXT_ATTRIBUTE_STRING_VALUES = new Set(["", "0", "false", "none", "off"]);

const removeNegativeModifier = (utility: string): string =>
  utility.startsWith("-") ? utility.slice(1) : utility;

const getHoverImageTransform = (classNameValue: string): string | null => {
  const rawTokens = splitTailwindClassName(classNameValue);
  const variantScopes = new Map<string, string[]>();
  for (const rawToken of rawTokens) {
    const { utility, variants } = parseTailwindClassNameToken(rawToken);
    if (
      !IMAGE_TRANSFORM_PATTERN.test(utility) ||
      !variants.some((variant) => HOVER_VARIANT_PATTERN.test(variant))
    ) {
      continue;
    }
    variantScopes.set(JSON.stringify(variants), variants);
  }

  for (const variants of variantScopes.values()) {
    const effectiveScale = getEffectiveTailwindClassNameToken(
      rawTokens,
      (utility) => removeNegativeModifier(utility).startsWith("scale-"),
      variants,
    );
    if (
      effectiveScale &&
      (effectiveScale.startsWith("-") ||
        !NEUTRAL_SCALE_PATTERN.test(removeNegativeModifier(effectiveScale)))
    ) {
      return [...variants, effectiveScale].join(":");
    }
    const effectiveRotation = getEffectiveTailwindClassNameToken(
      rawTokens,
      (utility) => removeNegativeModifier(utility).startsWith("rotate-"),
      variants,
    );
    if (
      effectiveRotation &&
      !NEUTRAL_ROTATE_PATTERN.test(removeNegativeModifier(effectiveRotation))
    ) {
      return [...variants, effectiveRotation].join(":");
    }
  }
  return null;
};

const getStaticIntrinsicFactoryTarget = (node: EsTreeNode): string | null => {
  const candidate = stripParenExpression(node);
  if (isNodeOfType(candidate, "MemberExpression")) {
    return getStaticPropertyName(candidate);
  }
  if (!isNodeOfType(candidate, "CallExpression")) return null;
  const target = candidate.arguments[0];
  return target &&
    !isNodeOfType(target, "SpreadElement") &&
    isNodeOfType(target, "Literal") &&
    typeof target.value === "string"
    ? target.value
    : null;
};

const isProvenMotionImage = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  if (!isProvenFramerMotionJsxElement(node, context.scopes)) return false;
  if (isNodeOfType(node.name, "JSXMemberExpression")) {
    return node.name.property.name === "img";
  }
  if (!isNodeOfType(node.name, "JSXIdentifier")) return false;
  const symbol = resolveConstIdentifierAlias(node.name, context.scopes);
  if (symbol?.kind === "import") {
    return getImportedName(symbol.declarationNode) === "img";
  }
  return Boolean(
    symbol?.kind === "const" &&
    symbol.initializer &&
    getStaticIntrinsicFactoryTarget(symbol.initializer) === "img",
  );
};

const isKnownInactiveContextExpression = (node: EsTreeNode, context: RuleContext): boolean => {
  const expression = stripParenExpression(node);
  if (isLiteralVoidExpression(expression)) return true;
  if (
    isNodeOfType(expression, "Identifier") &&
    expression.name === "undefined" &&
    context.scopes.isGlobalReference(expression)
  ) {
    return true;
  }
  if (!isNodeOfType(expression, "Literal")) return false;
  if (expression.value === false || expression.value === null || expression.value === 0) {
    return true;
  }
  return (
    typeof expression.value === "string" &&
    INACTIVE_CONTEXT_ATTRIBUTE_STRING_VALUES.has(expression.value.trim().toLowerCase())
  );
};

const isPotentiallyActiveContextAttribute = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  context: RuleContext,
): boolean => {
  if (!attribute.value) return true;
  if (isNodeOfType(attribute.value, "Literal")) {
    return !isKnownInactiveContextExpression(attribute.value, context);
  }
  return (
    isNodeOfType(attribute.value, "JSXExpressionContainer") &&
    !isKnownInactiveContextExpression(attribute.value.expression, context)
  );
};

const isPotentiallyActiveEventHandler = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  context: RuleContext,
): boolean => {
  if (
    !attribute.value ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
    isKnownInactiveContextExpression(attribute.value.expression, context)
  ) {
    return false;
  }
  const expression = stripParenExpression(attribute.value.expression);
  return !isNodeOfType(expression, "Literal");
};

const hasActiveDragAttribute = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  for (const attributeName of ["drag", "draggable"]) {
    const attribute = getAuthoritativeJsxAttribute(node.attributes, attributeName);
    if (!attribute) continue;
    if (isPotentiallyActiveContextAttribute(attribute, context)) return true;
  }
  return false;
};

const hasFunctionalImageContextEvidence = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  let currentNode: EsTreeNode | null | undefined = node;
  while (currentNode) {
    const openingElement = isNodeOfType(currentNode, "JSXOpeningElement")
      ? currentNode
      : isNodeOfType(currentNode, "JSXElement")
        ? currentNode.openingElement
        : null;
    if (openingElement) {
      if (hasActiveDragAttribute(openingElement, context)) return true;
      const elementName = resolveJsxElementName(openingElement);
      if (
        elementName &&
        tokenizeIdentifierWords(elementName).some((word) =>
          FUNCTIONAL_IMAGE_CONTEXT_IDENTIFIER_WORDS.has(word),
        )
      ) {
        return true;
      }
      for (const attribute of openingElement.attributes) {
        if (!isNodeOfType(attribute, "JSXAttribute")) continue;
        const attributeName = getJsxAttributeName(attribute.name);
        if (!attributeName) continue;
        const authoritativeAttribute = getAuthoritativeJsxAttribute(
          openingElement.attributes,
          attributeName,
        );
        if (authoritativeAttribute !== attribute) continue;
        if (
          FUNCTIONAL_IMAGE_CONTEXT_PATTERN.test(attributeName) &&
          isPotentiallyActiveContextAttribute(attribute, context)
        ) {
          return true;
        }
        if (/^onDrag/i.test(attributeName) && isPotentiallyActiveEventHandler(attribute, context)) {
          return true;
        }
        if (!FUNCTIONAL_IMAGE_CONTEXT_VALUE_ATTRIBUTE_NAMES.has(attributeName)) continue;
        const staticValues = getJsxPropStaticStringValues(attribute, context.scopes);
        if (staticValues?.some((value) => FUNCTIONAL_IMAGE_CONTEXT_PATTERN.test(value))) {
          return true;
        }
      }
    }
    currentNode = currentNode.parent;
  }
  return false;
};

const getMotionHoverTransformProperty = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): string | null => {
  if (!isProvenMotionImage(node, context) || hasFunctionalImageContextEvidence(node, context)) {
    return null;
  }
  const whileHoverObject = getStaticMotionPropObject(node, "whileHover", context.scopes);
  if (!whileHoverObject) return null;
  for (const propertyName of MOTION_IMAGE_SCALE_PROPERTY_NAMES) {
    const property = getEffectiveStyleProperty(whileHoverObject.properties, propertyName);
    if (!property) continue;
    const value = getStylePropertyNumberValue(property);
    if (value !== null && value !== MOTION_IMAGE_NEUTRAL_SCALE) return propertyName;
  }
  for (const propertyName of MOTION_IMAGE_ROTATION_PROPERTY_NAMES) {
    const property = getEffectiveStyleProperty(whileHoverObject.properties, propertyName);
    if (!property) continue;
    const value = getStylePropertyNumberValue(property);
    if (value !== null && value !== MOTION_IMAGE_NEUTRAL_ROTATION_DEGREES) return propertyName;
  }
  return null;
};

export const noImageHoverTransform = defineRule({
  id: "no-image-hover-transform",
  title: "Image scales or rotates on hover",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Keep the image stable, or use a subtler hover response tied to an actual interaction affordance.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (isNodeOfType(node.name, "JSXIdentifier") && node.name.name === "img") {
        const classNameValue = getStringFromClassNameAttr(node);
        if (!classNameValue) return;
        const hoverTransform = getHoverImageTransform(classNameValue);
        if (!hoverTransform) return;
        if (hasFunctionalImageContextEvidence(node, context)) return;
        context.report({
          node,
          message: `The ${hoverTransform} treatment makes the image itself shift under the pointer. Use a steadier hover affordance.`,
        });
        return;
      }
      const motionTransformProperty = getMotionHoverTransformProperty(node, context);
      if (!motionTransformProperty) return;
      context.report({
        node,
        message: `The whileHover ${motionTransformProperty} treatment makes the image itself shift under the pointer. Use a steadier hover affordance.`,
      });
    },
  }),
});
