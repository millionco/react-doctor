import { LAYOUT_PROPERTIES, MOTION_ANIMATE_PROPS } from "../../constants/style.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isProvenBrowserApiReceiver } from "../../utils/is-proven-browser-api-receiver.js";
import { getStaticWebAnimationKeyframes } from "../../utils/get-static-web-animation-keyframes.js";

const toCamelCasePropertyName = (propertyName: string): string =>
  propertyName.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());

const isMotionElement = (attributeNode: EsTreeNode): boolean => {
  const openingElement = attributeNode.parent;
  if (!openingElement || !isNodeOfType(openingElement, "JSXOpeningElement")) return false;

  const elementName = openingElement.name;
  if (
    isNodeOfType(elementName, "JSXMemberExpression") &&
    isNodeOfType(elementName.object, "JSXIdentifier") &&
    (elementName.object.name === "motion" || elementName.object.name === "m")
  )
    return true;

  if (isNodeOfType(elementName, "JSXIdentifier") && elementName.name.startsWith("Motion"))
    return true;

  return false;
};

export const noLayoutPropertyAnimation = defineRule({
  id: "no-layout-property-animation",
  title: "Animating a layout property",
  tags: ["test-noise"],
  severity: "error",
  recommendation:
    "Use `transform: translateX()` or `scale()` instead. They animate smoothly without making the browser redo layout or repaint",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || !MOTION_ANIMATE_PROPS.has(node.name.name))
        return;
      if (!node.value || !isNodeOfType(node.value, "JSXExpressionContainer")) return;
      if (!isMotionElement(node)) return;

      const expression = node.value.expression;
      if (!isNodeOfType(expression, "ObjectExpression")) return;

      for (const property of expression.properties ?? []) {
        if (!isNodeOfType(property, "Property")) continue;
        let propertyName = null;
        if (isNodeOfType(property.key, "Identifier")) {
          propertyName = property.key.name;
        } else if (
          isNodeOfType(property.key, "Literal") &&
          typeof property.key.value === "string"
        ) {
          propertyName = property.key.value;
        }

        if (propertyName && LAYOUT_PROPERTIES.has(propertyName)) {
          context.report({
            node: property,
            message: `This stutters because animating "${propertyName}" makes the browser redo page layout every frame, so animate transform or scale instead, or use the layout prop`,
          });
        }
      }
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (getStaticPropertyName(node.callee) !== "animate") return;
      if (!isProvenBrowserApiReceiver(node.callee.object, "dom-event-target", context.scopes)) {
        return;
      }
      const keyframesArgument = node.arguments?.[0];
      if (!keyframesArgument) return;
      for (const keyframe of getStaticWebAnimationKeyframes(keyframesArgument)) {
        if (!isNodeOfType(keyframe, "ObjectExpression")) continue;
        for (const property of keyframe.properties) {
          if (!isNodeOfType(property, "Property")) continue;
          const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
          if (!propertyName) continue;
          const normalizedPropertyName = toCamelCasePropertyName(propertyName);
          if (!LAYOUT_PROPERTIES.has(normalizedPropertyName)) continue;
          context.report({
            node: property,
            message: `This Web Animation changes "${propertyName}" every frame, forcing layout work. Animate transform or opacity instead.`,
          });
        }
      }
    },
  }),
});
