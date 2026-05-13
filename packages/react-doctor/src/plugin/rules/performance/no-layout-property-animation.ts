import { LAYOUT_PROPERTIES, MOTION_ANIMATE_PROPS } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const isMotionElement = (attributeNode: EsTreeNode): boolean => {
  const openingElement = attributeNode.parent;
  if (!openingElement || openingElement.type !== "JSXOpeningElement") return false;

  const elementName = openingElement.name;
  if (
    elementName?.type === "JSXMemberExpression" &&
    elementName.object?.type === "JSXIdentifier" &&
    (elementName.object.name === "motion" || elementName.object.name === "m")
  )
    return true;

  if (elementName?.type === "JSXIdentifier" && elementName.name.startsWith("Motion")) return true;

  return false;
};

export const noLayoutPropertyAnimation = defineRule<Rule>({
  recommendation:
    "Use `transform: translateX()` or `scale()` instead — they run on the compositor and skip layout/paint",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || !MOTION_ANIMATE_PROPS.has(node.name.name)) return;
      if (!node.value || node.value.type !== "JSXExpressionContainer") return;
      if (isMotionElement(node)) return;

      const expression = node.value.expression;
      if (expression?.type !== "ObjectExpression") return;

      for (const property of expression.properties ?? []) {
        if (property.type !== "Property") continue;
        let propertyName = null;
        if (property.key?.type === "Identifier") {
          propertyName = property.key.name;
        } else if (property.key?.type === "Literal") {
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
