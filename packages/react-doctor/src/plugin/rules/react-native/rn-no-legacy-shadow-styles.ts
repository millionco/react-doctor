import { LEGACY_SHADOW_STYLE_PROPERTIES } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const reportLegacyShadowProperties = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
  context: RuleContext,
): void => {
  const legacyShadowPropertyNames: string[] = [];

  for (const property of objectExpression.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    const propertyName = isNodeOfType(property.key, "Identifier") ? property.key.name : null;
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
  requires: ["react-native"],
  framework: "react-native",
  severity: "warn",
  category: "React Native",
  recommendation:
    "Use `boxShadow` for cross-platform shadows on the new architecture instead of platform-specific shadow properties",
  examples: [
    {
      before:
        "<View style={{ shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, elevation: 3 }} />",
      after: "<View style={{ boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }} />",
    },
  ],
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "style") return;
      if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;

      const expression = node.value.expression;

      if (isNodeOfType(expression, "ObjectExpression")) {
        reportLegacyShadowProperties(expression, context);
      } else if (isNodeOfType(expression, "ArrayExpression")) {
        for (const element of expression.elements ?? []) {
          if (isNodeOfType(element, "ObjectExpression")) {
            reportLegacyShadowProperties(element, context);
          }
        }
      }
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (
        !isNodeOfType(node.callee.object, "Identifier") ||
        node.callee.object.name !== "StyleSheet"
      )
        return;
      if (!isMemberProperty(node.callee, "create")) return;

      const stylesArgument = node.arguments?.[0];
      if (!isNodeOfType(stylesArgument, "ObjectExpression")) return;

      for (const styleDefinition of stylesArgument.properties ?? []) {
        if (!isNodeOfType(styleDefinition, "Property")) continue;
        if (!isNodeOfType(styleDefinition.value, "ObjectExpression")) continue;
        reportLegacyShadowProperties(styleDefinition.value, context);
      }
    },
  }),
});
