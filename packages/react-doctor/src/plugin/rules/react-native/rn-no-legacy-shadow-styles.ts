import { LEGACY_SHADOW_STYLE_PROPERTIES } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const reportLegacyShadowProperties = (objectExpression: EsTreeNode, context: RuleContext): void => {
  const legacyShadowPropertyNames: string[] = [];

  for (const property of objectExpression.properties ?? []) {
    if (property.type !== "Property") continue;
    const propertyName = property.key?.type === "Identifier" ? property.key.name : null;
    if (propertyName && LEGACY_SHADOW_STYLE_PROPERTIES.has(propertyName)) {
      legacyShadowPropertyNames.push(propertyName);
    }
  }

  if (legacyShadowPropertyNames.length === 0) return;

  const quotedPropertyNames = legacyShadowPropertyNames.map((name) => `"${name}"`).join(", ");
  context.report({
    node: objectExpression,
    message: `Legacy shadow style${legacyShadowPropertyNames.length > 1 ? "s" : ""} ${quotedPropertyNames} — use boxShadow for cross-platform shadows on the new architecture`,
  });
};

export const rnNoLegacyShadowStyles = defineRule<Rule>({
  recommendation:
    "Use `boxShadow` for cross-platform shadows on the new architecture instead of platform-specific shadow properties",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "style") return;
      if (node.value?.type !== "JSXExpressionContainer") return;

      const expression = node.value.expression;

      if (expression?.type === "ObjectExpression") {
        reportLegacyShadowProperties(expression, context);
      } else if (expression?.type === "ArrayExpression") {
        for (const element of expression.elements ?? []) {
          if (element?.type === "ObjectExpression") {
            reportLegacyShadowProperties(element, context);
          }
        }
      }
    },
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression") return;
      if (node.callee.object?.type !== "Identifier" || node.callee.object.name !== "StyleSheet")
        return;
      if (!isMemberProperty(node.callee, "create")) return;

      const stylesArgument = node.arguments?.[0];
      if (stylesArgument?.type !== "ObjectExpression") return;

      for (const styleDefinition of stylesArgument.properties ?? []) {
        if (styleDefinition.type !== "Property") continue;
        if (styleDefinition.value?.type !== "ObjectExpression") continue;
        reportLegacyShadowProperties(styleDefinition.value, context);
      }
    },
  }),
});
