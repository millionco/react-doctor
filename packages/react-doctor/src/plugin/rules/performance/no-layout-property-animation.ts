import { LAYOUT_PROPERTIES, MOTION_ANIMATE_PROPS } from "../../constants/style.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

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

export const noLayoutPropertyAnimation = defineRule<Rule>({
  framework: "global",
  severity: "error",
  category: "Performance",
  recommendation:
    "Use `transform: translateX()` or `scale()` instead — they run on the compositor and skip layout/paint",
  examples: [
    {
      before: "<div animate={{ left: 100, width: 200 }} />",
      after: "<div animate={{ x: 100, scaleX: 2 }} />",
    },
  ],
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || !MOTION_ANIMATE_PROPS.has(node.name.name))
        return;
      if (!node.value || !isNodeOfType(node.value, "JSXExpressionContainer")) return;
      if (isMotionElement(node)) return;

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
            message: `Animating layout property "${propertyName}" triggers layout recalculation every frame — use transform/scale or the layout prop`,
          });
        }
      }
    },
  }),
});
