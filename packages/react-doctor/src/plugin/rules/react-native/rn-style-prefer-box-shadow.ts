import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const LEGACY_SHADOW_KEYS = new Set([
  "shadowColor",
  "shadowOffset",
  "shadowOpacity",
  "shadowRadius",
  "elevation",
]);

const findLegacyShadowProperty = (
  objectExpression: EsTreeNode,
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
  framework: "react-native",
  severity: "warn",
  category: "React Native",
  recommendation:
    'Use the cross-platform CSS `boxShadow` string (RN v7+): `boxShadow: "0 2px 8px rgba(0,0,0,0.1)"` instead of platform-specific shadow*/elevation keys',
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      const attrName = node.name.name;
      if (attrName !== "style" && !attrName.endsWith("Style")) return;
      if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;
      const expression = node.value.expression;
      if (!isNodeOfType(expression, "ObjectExpression")) return;
      const match = findLegacyShadowProperty(expression);
      if (!match) return;
      context.report({
        node: match.node,
        message: `${match.keyName} is iOS/Android-platform-specific — use the cross-platform CSS \`boxShadow\` string (e.g. \`boxShadow: "0 2px 8px rgba(0,0,0,0.1)"\`) on RN v7+`,
      });
    },
    CallExpression(node: EsTreeNode) {
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
          message: `${match.keyName} is iOS/Android-platform-specific — use the cross-platform CSS \`boxShadow\` string on RN v7+`,
        });
      }
    },
  }),
});
