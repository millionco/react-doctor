import { LEGACY_SHADOW_STYLE_PROPERTIES } from "../../constants/react-native.js";
import { defineRule } from "../../utils/define-rule.js";
import { isLegacyArchReactNativeFile } from "../../utils/is-legacy-arch-react-native-file.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const EMPTY_VISITORS: RuleVisitors = {};

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
    message: `Shadow style${legacyShadowPropertyNames.length > 1 ? "s" : ""} ${quotedPropertyNames} only work on one platform, so your users on the other see no shadow.`,
  });
};

export const rnNoLegacyShadowStyles = defineRule({
  id: "rn-no-legacy-shadow-styles",
  title: "Legacy platform-specific shadow styles",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Use `boxShadow` for shadows that work on both platforms on the new architecture, instead of platform-specific shadow properties.",
  create: (context: RuleContext) => {
    // The doc's FP carve-out: on legacy-architecture apps (or RN < 0.76)
    // boxShadow isn't supported, so the platform-specific shadow props are
    // the only option and the rule must stay silent.
    if (context.filename && isLegacyArchReactNativeFile(normalizeFilename(context.filename))) {
      return EMPTY_VISITORS;
    }
    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        const attrName = node.name.name;
        if (attrName !== "style" && !attrName.endsWith("Style")) return;
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
    };
  },
});
