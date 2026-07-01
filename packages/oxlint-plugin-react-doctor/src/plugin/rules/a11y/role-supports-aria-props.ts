import { ARIA_PROPERTIES } from "../../constants/aria-properties.js";
import { VALID_ARIA_ROLES } from "../../constants/aria-roles.js";
import { ROLE_SUPPORTS_ARIA_PROPS } from "../../constants/role-supports-aria-props.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getImplicitRole } from "../../utils/get-implicit-role.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const buildMessageDefault = (role: string, propName: string): string =>
  `Screen reader users get no help from \`${propName}\` because role \`${role}\` ignores it, so remove it or change the role.`;

const buildMessageImplicit = (role: string, propName: string, elementType: string): string =>
  `Screen reader users get no help from \`${propName}\` because \`${elementType}\` has role \`${role}\`, which ignores it, so remove \`${propName}\` or change the element.`;

// Port of `oxc_linter::rules::jsx_a11y::role_supports_aria_props`.
// Reports `aria-*` props that aren't supported by the element's
// effective ARIA role (explicit > implicit).
export const roleSupportsAriaProps = defineRule({
  id: "role-supports-aria-props",
  title: "Unsupported ARIA prop for role",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Only use `aria-*` attributes that the element's role supports.",
  category: "Accessibility",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const elementType = getElementType(node, context.settings);
      const roleAttribute = hasJsxPropIgnoreCase(node.attributes, "role");
      const role = roleAttribute
        ? getJsxPropStringValue(roleAttribute)
        : getImplicitRole(node, elementType);
      if (!role) return;
      if (!VALID_ARIA_ROLES.has(role)) return;
      const isImplicit = !roleAttribute;
      const supported = ROLE_SUPPORTS_ARIA_PROPS[role];
      if (!supported) return;

      for (const attribute of node.attributes) {
        if (!isNodeOfType(attribute as EsTreeNode, "JSXAttribute")) continue;
        const attributeNode = attribute as EsTreeNodeOfType<"JSXAttribute">;
        if (!isNodeOfType(attributeNode.name as EsTreeNode, "JSXIdentifier")) continue;
        const propRawName = getJsxAttributeName(
          attributeNode.name as EsTreeNodeOfType<"JSXIdentifier">,
        );
        if (!propRawName) continue;
        const propName = propRawName.toLowerCase();
        if (!propName.startsWith("aria-")) continue;
        if (!ARIA_PROPERTIES.has(propName)) continue;
        if (supported.has(propName)) continue;
        context.report({
          node: attribute as EsTreeNode,
          message: isImplicit
            ? buildMessageImplicit(role, propName, elementType)
            : buildMessageDefault(role, propName),
        });
      }
    },
  }),
});
