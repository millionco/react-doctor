import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const LEGACY_SHADOW_KEYS = new Set([
  "shadowColor",
  "shadowOffset",
  "shadowOpacity",
  "shadowRadius",
  "elevation",
]);

const findLegacyShadowProperty = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
): { keyName: string; node: EsTreeNode } | null => {
  for (const property of objectExpression.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    if (!isNodeOfType(property.key, "Identifier")) continue;
    if (LEGACY_SHADOW_KEYS.has(property.key.name)) {
      return { keyName: property.key.name, node: property };
    }
  }
  return null;
};

// HACK: React Native v7+ supports the standard CSS `boxShadow` string
// (`"0 2px 8px rgba(0,0,0,0.1)"`) which renders identically on iOS and
// Android. The legacy `shadowColor`/`shadowOffset`/`shadowOpacity`/
// `shadowRadius` keys only work on iOS, and `elevation` is Android-only,
// so cross-platform code historically had to declare both — `boxShadow`
// collapses that into one key.
export const rnStylePreferBoxShadow = defineRule<Rule>({
  id: "rn-style-prefer-boxshadow",
  title: "Platform-specific shadow keys over boxShadow",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    'These shadow keys only work on one platform. On RN v7+, use the CSS `boxShadow` string instead, like `boxShadow: "0 2px 8px rgba(0,0,0,0.1)"`, which works on both.',
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      const attrName = node.name.name;
      if (attrName !== "style" && !attrName.endsWith("Style")) return;
      if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;
      const expression = node.value.expression;

      if (isNodeOfType(expression, "ObjectExpression")) {
        const match = findLegacyShadowProperty(expression);
        if (match) {
          context.report({
            node: match.node,
            message: `Your users on the other platform see no shadow when you use ${match.keyName}.`,
          });
        }
      } else if (isNodeOfType(expression, "ArrayExpression")) {
        for (const element of expression.elements ?? []) {
          if (!isNodeOfType(element, "ObjectExpression")) continue;
          const match = findLegacyShadowProperty(element);
          if (match) {
            context.report({
              node: match.node,
              message: `Your users on the other platform see no shadow when you use ${match.keyName}.`,
            });
            return;
          }
        }
      }
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (!isNodeOfType(node.callee.object, "Identifier")) return;
      if (node.callee.object.name !== "StyleSheet") return;
      if (!isNodeOfType(node.callee.property, "Identifier")) return;
      if (node.callee.property.name !== "create") return;
      const arg = node.arguments?.[0];
      if (!isNodeOfType(arg, "ObjectExpression")) return;
      for (const property of arg.properties ?? []) {
        if (!isNodeOfType(property, "Property")) continue;
        if (!isNodeOfType(property.value, "ObjectExpression")) continue;
        const match = findLegacyShadowProperty(property.value);
        if (!match) continue;
        context.report({
          node: match.node,
          message: `Your users on the other platform see no shadow when you use ${match.keyName}.`,
        });
      }
    },
  }),
});
