import { CSS_PROPERTIES, VENDOR_PREFIXES } from "../../constants/style.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { readSolidRuleSettings } from "../../utils/read-solid-rule-settings.js";

interface SolidStylePropSettings {
  styleProps?: ReadonlyArray<string>;
  allowString?: boolean;
}

const camelToKebab = (name: string): string =>
  name.replace(/[A-Z]/g, (uppercaseMatch) => `-${uppercaseMatch.toLowerCase()}`);

const LENGTH_PERCENTAGE_PATTERN = /\b(?:width|height|margin|padding|border-width|font-size)\b/i;

const isVendorPrefixed = (name: string): boolean =>
  VENDOR_PREFIXES.some((prefix) => name.startsWith(prefix));

const objectPropertyKeyName = (property: EsTreeNodeOfType<"Property">): string | null => {
  if (isNodeOfType(property.key, "Identifier")) return property.key.name;
  if (isNodeOfType(property.key, "Literal") && typeof property.key.value === "string") {
    return property.key.value;
  }
  return null;
};

export const solidStyleProp = defineRule<Rule>({
  id: "solid-style-prop",
  severity: "warn",
  requires: ["solid"],
  recommendation:
    "Use kebab-case CSS property names (`font-size`, not `fontSize`) in Solid's `style` prop, and string values with units (`'12px'`, not `12`) for length properties.",
  create: (context: RuleContext) => {
    const settings = readSolidRuleSettings<SolidStylePropSettings>(
      context.settings,
      "solidStyleProp",
    );
    const styleProps = new Set(settings.styleProps ?? ["style"]);
    const allowString = Boolean(settings.allowString);
    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        const propertyName = getJsxAttributeName(node.name);
        if (!propertyName || !styleProps.has(propertyName)) return;
        if (!node.value) return;
        const style = isNodeOfType(node.value, "JSXExpressionContainer")
          ? (node.value.expression as EsTreeNode)
          : (node.value as EsTreeNode);
        if (isNodeOfType(style, "Literal") && typeof style.value === "string" && !allowString) {
          context.report({
            node: style,
            message: "Use an object for the `style` prop instead of a string.",
          });
          return;
        }
        if (isNodeOfType(style, "TemplateLiteral") && !allowString) {
          context.report({
            node: style,
            message: "Use an object for the `style` prop instead of a string.",
          });
          return;
        }
        if (!isNodeOfType(style, "ObjectExpression")) return;
        for (const property of style.properties) {
          if (!isNodeOfType(property, "Property")) continue;
          const keyName = objectPropertyKeyName(property);
          if (!keyName) continue;
          if (keyName.startsWith("--")) continue;
          if (!CSS_PROPERTIES.has(keyName) && !isVendorPrefixed(keyName)) {
            const kebabName = camelToKebab(keyName);
            if (CSS_PROPERTIES.has(kebabName)) {
              context.report({
                node: property.key,
                message: `Use \`"${kebabName}"\` instead of \`${keyName}\` — Solid expects kebab-case CSS property names.`,
              });
            } else {
              context.report({
                node: property.key,
                message: `\`${keyName}\` is not a valid CSS property.`,
              });
            }
            continue;
          }
          if (LENGTH_PERCENTAGE_PATTERN.test(keyName)) {
            const value = property.value;
            if (
              isNodeOfType(value, "Literal") &&
              typeof value.value === "number" &&
              value.value !== 0
            ) {
              context.report({
                node: value,
                message:
                  "This CSS property value should be a string with a unit; Solid does not automatically append `px`.",
              });
            }
          }
        }
      },
    };
  },
});
