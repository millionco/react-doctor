import { MARQUEE_HORIZONTAL_TRAVEL_THRESHOLD_PERCENTAGE_POINTS } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStaticStringValues } from "../../utils/get-jsx-prop-static-string-values.js";
import { getStaticJsxDescendantOpeningElements } from "../../utils/get-static-jsx-descendant-opening-elements.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getStaticMotionPropObject } from "../../utils/get-static-motion-prop-object.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";

const MOVEMENT_CONTROL_ACTION_PATTERN = /\b(?:next|pause|play|prev|previous|resume|stop)\b/i;
const MOVEMENT_CONTROL_CONTEXT_PATTERN = /\b(?:carousel|marquee|slide|slider|ticker)\b/i;
const LIVE_REGION_ROLES = new Set(["alert", "log", "progressbar", "status", "timer"]);
const HORIZONTAL_MOTION_PROPERTY_NAMES = ["x", "translateX"];

const getPercentageValue = (node: EsTreeNode): number | null => {
  if (!isNodeOfType(node, "Literal") || typeof node.value !== "string") return null;
  const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))%$/.exec(node.value.trim());
  return match ? Number.parseFloat(match[1]) : null;
};

const getPercentageValues = (node: EsTreeNode): ReadonlyArray<number> | null => {
  if (!isNodeOfType(node, "ArrayExpression")) {
    const percentageValue = getPercentageValue(node);
    return percentageValue === null ? null : [percentageValue];
  }
  const percentageValues: number[] = [];
  for (const element of node.elements) {
    if (!element || isNodeOfType(element, "SpreadElement")) return null;
    const percentageValue = getPercentageValue(element);
    if (percentageValue === null) return null;
    percentageValues.push(percentageValue);
  }
  return percentageValues.length > 0 ? percentageValues : null;
};

const isInfiniteRepeatProperty = (property: EsTreeNode, context: RuleContext): boolean =>
  isNodeOfType(property, "Property") &&
  ((isNodeOfType(property.value, "Identifier") &&
    property.value.name === "Infinity" &&
    context.scopes.isGlobalReference(property.value)) ||
    (isNodeOfType(property.value, "Literal") && property.value.value === Infinity));

const hasInfiniteMotionRepeat = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  animateObject: EsTreeNodeOfType<"ObjectExpression">,
  context: RuleContext,
): boolean => {
  const transitionObjects: EsTreeNodeOfType<"ObjectExpression">[] = [];
  const transitionObject = getStaticMotionPropObject(openingElement, "transition", context.scopes);
  if (transitionObject) transitionObjects.push(transitionObject);
  const nestedTransitionProperty = getEffectiveStyleProperty(
    animateObject.properties,
    "transition",
  );
  if (
    nestedTransitionProperty &&
    isNodeOfType(nestedTransitionProperty.value, "ObjectExpression")
  ) {
    transitionObjects.push(nestedTransitionProperty.value);
  }
  return transitionObjects.some((candidate) => {
    const repeatProperty = getEffectiveStyleProperty(candidate.properties, "repeat");
    return Boolean(repeatProperty && isInfiniteRepeatProperty(repeatProperty, context));
  });
};

const getHorizontalTravel = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  animateObject: EsTreeNodeOfType<"ObjectExpression">,
  context: RuleContext,
): number | null => {
  const initialObject = getStaticMotionPropObject(openingElement, "initial", context.scopes);
  for (const propertyName of HORIZONTAL_MOTION_PROPERTY_NAMES) {
    const animateProperty = getEffectiveStyleProperty(animateObject.properties, propertyName);
    if (!animateProperty) continue;
    const animateValues = getPercentageValues(animateProperty.value);
    if (!animateValues) continue;
    const percentageValues = [...animateValues];
    if (percentageValues.length === 1 && initialObject) {
      const initialProperty = getEffectiveStyleProperty(initialObject.properties, propertyName);
      if (!initialProperty) continue;
      const initialValues = getPercentageValues(initialProperty.value);
      if (!initialValues || initialValues.length !== 1) continue;
      percentageValues.push(initialValues[0]);
    }
    if (percentageValues.length < 2) continue;
    return Math.max(...percentageValues) - Math.min(...percentageValues);
  }
  return null;
};

const hasDynamicJsxAttributeValue = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  if (!attribute.value || isNodeOfType(attribute.value, "Literal")) return false;
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return true;
  const expression = attribute.value.expression;
  return !(
    isNodeOfType(expression, "Literal") ||
    (isNodeOfType(expression, "TemplateLiteral") && expression.expressions.length === 0)
  );
};

const hasUnresolvedTextTrackContent = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "JSXExpressionContainer")) {
    const expression = node.expression;
    if (
      isNodeOfType(expression, "Literal") ||
      (isNodeOfType(expression, "TemplateLiteral") && expression.expressions.length === 0) ||
      isNodeOfType(expression, "JSXEmptyExpression")
    ) {
      return false;
    }
    if (isNodeOfType(expression, "JSXElement") || isNodeOfType(expression, "JSXFragment")) {
      return hasUnresolvedTextTrackContent(expression);
    }
    return true;
  }
  if (isNodeOfType(node, "JSXElement")) {
    if (
      node.openingElement.selfClosing ||
      !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
      !/^[a-z]/.test(node.openingElement.name.name) ||
      hasJsxSpreadAttribute(node.openingElement.attributes) ||
      node.openingElement.attributes.some(
        (attribute) =>
          isNodeOfType(attribute, "JSXAttribute") && hasDynamicJsxAttributeValue(attribute),
      )
    ) {
      return true;
    }
    return node.children.some(hasUnresolvedTextTrackContent);
  }
  if (isNodeOfType(node, "JSXFragment")) {
    return node.children.some(hasUnresolvedTextTrackContent);
  }
  return isNodeOfType(node, "JSXSpreadChild");
};

const hasUnresolvedOrLiveSemantics = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  if (hasJsxSpreadAttribute(openingElement.attributes)) return true;
  const roleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "role");
  const roleValues = roleAttribute
    ? getJsxPropStaticStringValues(roleAttribute, context.scopes)
    : [];
  if (!roleValues) return true;
  if (
    roleValues.some((role) =>
      role
        .toLowerCase()
        .split(/\s+/)
        .some((roleToken) => LIVE_REGION_ROLES.has(roleToken)),
    )
  ) {
    return true;
  }
  const ariaLiveAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "aria-live");
  if (!ariaLiveAttribute) return false;
  const ariaLiveValues = getJsxPropStaticStringValues(ariaLiveAttribute, context.scopes);
  return !ariaLiveValues || ariaLiveValues.some((value) => value.toLowerCase() !== "off");
};

const isInsideUnresolvedOrLiveRegion = (
  element: EsTreeNodeOfType<"JSXElement">,
  context: RuleContext,
): boolean => {
  let currentNode: EsTreeNode | null | undefined = element;
  while (currentNode) {
    if (
      isNodeOfType(currentNode, "JSXElement") &&
      hasUnresolvedOrLiveSemantics(currentNode.openingElement, context)
    ) {
      return true;
    }
    currentNode = currentNode.parent;
  }
  return false;
};

const findNearestJsxContainer = (
  element: EsTreeNodeOfType<"JSXElement">,
): EsTreeNodeOfType<"JSXElement"> | null => {
  let ancestor = element.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) return ancestor;
    ancestor = ancestor.parent;
  }
  return null;
};

const hasPauseOrCarouselControl = (
  containers: ReadonlyArray<EsTreeNodeOfType<"JSXElement">>,
  movingElement: EsTreeNodeOfType<"JSXElement">,
  context: RuleContext,
): boolean => {
  const movingIdAttribute = getAuthoritativeJsxAttribute(
    movingElement.openingElement.attributes,
    "id",
  );
  const movingIds = movingIdAttribute
    ? getJsxPropStaticStringValues(movingIdAttribute, context.scopes)
    : [];
  return containers
    .flatMap((container) => getStaticJsxDescendantOpeningElements(container))
    .some((openingElement) => {
      if (getElementType(openingElement, context.settings) !== "button") return false;
      const ariaLabelAttribute = getAuthoritativeJsxAttribute(
        openingElement.attributes,
        "aria-label",
      );
      const ariaLabelValues = ariaLabelAttribute
        ? getJsxPropStaticStringValues(ariaLabelAttribute, context.scopes)
        : [];
      const buttonElement = openingElement.parent;
      const visibleLabel = isNodeOfType(buttonElement, "JSXElement")
        ? getStaticJsxText(buttonElement).trim()
        : "";
      const controlLabels = [...(ariaLabelValues ?? []), visibleLabel].filter(Boolean);
      if (!controlLabels.some((label) => MOVEMENT_CONTROL_ACTION_PATTERN.test(label))) return false;
      if (controlLabels.some((label) => MOVEMENT_CONTROL_CONTEXT_PATTERN.test(label))) return true;
      const ariaControlsAttribute = getAuthoritativeJsxAttribute(
        openingElement.attributes,
        "aria-controls",
      );
      const controlledIds = ariaControlsAttribute
        ? getJsxPropStaticStringValues(ariaControlsAttribute, context.scopes)
        : [];
      return Boolean(
        movingIds &&
        controlledIds &&
        controlledIds.some((controlledId) => movingIds.includes(controlledId)),
      );
    });
};

export const noAutoScrollingContent = defineRule({
  id: "no-auto-scrolling-content",
  title: "Content auto-scrolls forever",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Keep content still so readers control the pace, or provide an accessible pause control for essential live movement.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (isInsideUnresolvedOrLiveRegion(node, context)) return;
      if (node.children.some(hasUnresolvedTextTrackContent) || !getStaticJsxText(node).trim())
        return;
      const animateObject = getStaticMotionPropObject(
        node.openingElement,
        "animate",
        context.scopes,
      );
      if (!animateObject || !hasInfiniteMotionRepeat(node.openingElement, animateObject, context)) {
        return;
      }
      const horizontalTravel = getHorizontalTravel(node.openingElement, animateObject, context);
      if (
        horizontalTravel === null ||
        horizontalTravel < MARQUEE_HORIZONTAL_TRAVEL_THRESHOLD_PERCENTAGE_POINTS
      ) {
        return;
      }
      const container = findNearestJsxContainer(node);
      const outerContainer = container ? findNearestJsxContainer(container) : null;
      const controlContainers = [container, outerContainer].filter(
        (candidate): candidate is EsTreeNodeOfType<"JSXElement"> => candidate !== null,
      );
      if (hasPauseOrCarouselControl(controlContainers, node, context)) return;
      context.report({
        node: node.openingElement,
        message:
          "This content moves horizontally on an endless loop, so readers cannot control its pace. Keep it still or provide an accessible pause control.",
      });
    },
  }),
});
