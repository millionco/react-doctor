import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getDirectUnreassignedInitializer } from "../../utils/get-direct-unreassigned-initializer.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenFramerMotionJsxElement } from "../../utils/is-proven-framer-motion-jsx-element.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

interface ConstraintProperty {
  readonly node: EsTreeNodeOfType<"Property">;
  readonly numericValue: number | null;
}

const getStaticNumericValue = (node: EsTreeNode): number | null => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "number") {
    return expression.value;
  }
  if (
    isNodeOfType(expression, "UnaryExpression") &&
    (expression.operator === "+" || expression.operator === "-")
  ) {
    const argument = stripParenExpression(expression.argument);
    if (isNodeOfType(argument, "Literal") && typeof argument.value === "number") {
      return expression.operator === "-" ? -argument.value : argument.value;
    }
  }
  return null;
};

const resolveConstraintObject = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  if (!attribute.value || !isNodeOfType(attribute.value, "JSXExpressionContainer")) return null;
  const expression = stripParenExpression(attribute.value.expression);
  if (isNodeOfType(expression, "ObjectExpression")) return expression;
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = scopes.symbolFor(expression);
  if (!symbol) return null;
  const initializer = getDirectUnreassignedInitializer(symbol);
  if (!initializer) return null;
  const unwrappedInitializer = stripParenExpression(initializer);
  return isNodeOfType(unwrappedInitializer, "ObjectExpression") ? unwrappedInitializer : null;
};

const collectConstraintProperties = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
): Map<string, ConstraintProperty> | null => {
  const properties = new Map<string, ConstraintProperty>();
  for (const property of objectExpression.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    ) {
      return null;
    }
    const propertyName = getStaticPropertyKeyName(property);
    if (!propertyName) return null;
    properties.set(propertyName, {
      node: property,
      numericValue: getStaticNumericValue(property.value),
    });
  }
  return properties;
};

const getDragAxis = (node: EsTreeNodeOfType<"JSXOpeningElement">): "x" | "y" | null => {
  const dragAttribute = getAuthoritativeJsxAttribute(node.attributes, "drag");
  if (!dragAttribute) return null;
  const dragValue = getStringLiteralAttributeValue(dragAttribute);
  return dragValue === "x" || dragValue === "y" ? dragValue : null;
};

export const motionDragAxisConstraintMismatch = defineRule({
  id: "motion-drag-axis-constraint-mismatch",
  title: "Motion drag constraints do not match the drag axis",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Constrain horizontal drags with left or right bounds and vertical drags with top or bottom bounds, keeping paired bounds in ascending order.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (
        hasJsxSpreadAttribute(node.attributes) ||
        !isProvenFramerMotionJsxElement(node, context.scopes)
      ) {
        return;
      }
      const dragAxis = getDragAxis(node);
      if (!dragAxis) return;
      const constraintsAttribute = getAuthoritativeJsxAttribute(node.attributes, "dragConstraints");
      if (!constraintsAttribute) return;
      const constraintObject = resolveConstraintObject(constraintsAttribute, context.scopes);
      if (!constraintObject) return;
      const properties = collectConstraintProperties(constraintObject);
      if (!properties) return;

      const primaryStart = dragAxis === "x" ? "left" : "top";
      const primaryEnd = dragAxis === "x" ? "right" : "bottom";
      const crossStart = dragAxis === "x" ? "top" : "left";
      const crossEnd = dragAxis === "x" ? "bottom" : "right";
      const hasPrimaryConstraint = properties.has(primaryStart) || properties.has(primaryEnd);
      const hasCrossConstraint = properties.has(crossStart) || properties.has(crossEnd);

      if (!hasPrimaryConstraint && hasCrossConstraint) {
        context.report({
          node: constraintsAttribute,
          message: `This ${dragAxis}-axis drag only has ${crossStart}/${crossEnd} constraints, so Motion cannot bound movement on its selected axis. Add ${primaryStart} or ${primaryEnd}.`,
        });
        return;
      }

      const startProperty = properties.get(primaryStart);
      const endProperty = properties.get(primaryEnd);
      if (!startProperty || !endProperty) return;
      if (startProperty.numericValue === null || endProperty.numericValue === null) return;
      if (startProperty.numericValue <= endProperty.numericValue) return;
      context.report({
        node: endProperty.node,
        message: `This ${primaryStart} bound is greater than ${primaryEnd}, so the ${dragAxis}-axis constraint interval is inverted. Keep ${primaryStart} less than or equal to ${primaryEnd}.`,
      });
    },
  }),
});
