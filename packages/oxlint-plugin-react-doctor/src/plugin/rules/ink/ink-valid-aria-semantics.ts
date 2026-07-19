import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveInkJsxElementName } from "../../utils/resolve-ink-api-name.js";

const INK_ARIA_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "list",
  "listbox",
  "listitem",
  "menu",
  "menuitem",
  "option",
  "progressbar",
  "radio",
  "radiogroup",
  "tab",
  "tablist",
  "table",
  "textbox",
  "timer",
  "toolbar",
]);

const INK_ARIA_STATE_NAMES = new Set([
  "busy",
  "checked",
  "disabled",
  "expanded",
  "multiline",
  "multiselectable",
  "readonly",
  "required",
  "selected",
]);

export const inkValidAriaSemantics = defineRule({
  id: "ink-valid-aria-semantics",
  title: "Invalid Ink accessibility semantics",
  category: "Accessibility",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.aria,
  recommendation:
    "Use a role supported by Ink and do not label elements hidden from screen readers.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const elementName = resolveInkJsxElementName(node, context.scopes);
      if (!elementName) return;
      const roleAttribute = findJsxAttribute(node.attributes, "aria-role");
      const role = roleAttribute ? getJsxPropStringValue(roleAttribute) : null;
      if (roleAttribute && elementName !== "Box") {
        context.report({
          node: roleAttribute,
          message: `Ink \`<${elementName}>\` does not support \`aria-role\`; put semantics on a \`<Box>\`.`,
        });
      } else if (roleAttribute && role && !INK_ARIA_ROLES.has(role)) {
        context.report({
          node: roleAttribute,
          message: `Ink does not expose the ARIA role \`${role}\` to screen readers.`,
        });
      }
      const stateAttribute = findJsxAttribute(node.attributes, "aria-state");
      if (stateAttribute && elementName !== "Box") {
        context.report({
          node: stateAttribute,
          message: `Ink \`<${elementName}>\` does not support \`aria-state\`; put semantics on a \`<Box>\`.`,
        });
      } else if (
        stateAttribute &&
        isNodeOfType(stateAttribute.value, "JSXExpressionContainer") &&
        isNodeOfType(stateAttribute.value.expression, "ObjectExpression")
      ) {
        const invalidStateProperty = stateAttribute.value.expression.properties.find((property) => {
          if (!isNodeOfType(property, "Property")) return false;
          const stateName = getStaticPropertyKeyName(property, { allowComputedString: true });
          return stateName !== null && !INK_ARIA_STATE_NAMES.has(stateName);
        });
        if (invalidStateProperty && isNodeOfType(invalidStateProperty, "Property")) {
          const stateName = getStaticPropertyKeyName(invalidStateProperty, {
            allowComputedString: true,
          });
          context.report({
            node: invalidStateProperty,
            message: `Ink does not expose the ARIA state \`${stateName}\` to screen readers.`,
          });
        }
      }
      const labelAttribute = findJsxAttribute(node.attributes, "aria-label");
      const hiddenAttribute = findJsxAttribute(node.attributes, "aria-hidden");
      const isHidden =
        hiddenAttribute &&
        (hiddenAttribute.value === null ||
          (isNodeOfType(hiddenAttribute.value, "JSXExpressionContainer") &&
            isNodeOfType(hiddenAttribute.value.expression, "Literal") &&
            hiddenAttribute.value.expression.value === true));
      if (!labelAttribute || !isHidden) return;
      context.report({
        node: labelAttribute,
        message: "`aria-label` has no effect when the Ink element is `aria-hidden`.",
      });
    },
  }),
});
