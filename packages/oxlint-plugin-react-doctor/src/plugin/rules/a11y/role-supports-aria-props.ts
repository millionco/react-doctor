import { ARIA_PROPERTIES } from "../../constants/aria-properties.js";
import { VALID_ARIA_ROLES } from "../../constants/aria-roles.js";
import { ROLE_SUPPORTS_ARIA_PROPS } from "../../constants/role-supports-aria-props.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getImplicitRole } from "../../utils/get-implicit-role.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getJsxPropStaticStringValues } from "../../utils/get-jsx-prop-static-string-values.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNullishExpression } from "../../utils/is-nullish-expression.js";

const buildMessageDefault = (roles: ReadonlyArray<string>, propName: string): string => {
  const roleList = roles.map((role) => `\`${role}\``).join(" / ");
  return `Screen reader users get no help from \`${propName}\` because role ${roleList} ignores it, so remove it or change the role.`;
};

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
      let ariaAttributes: Array<{ attribute: EsTreeNode; propName: string }> | null = null;
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
        // `aria-x={undefined}` / `{null}` renders no attribute at all, so
        // there is nothing for the role to ignore (oxc `is_nullish_value`).
        const attributeValue = attributeNode.value;
        if (
          attributeValue &&
          isNodeOfType(attributeValue, "JSXExpressionContainer") &&
          isNullishExpression(attributeValue.expression as EsTreeNode)
        ) {
          continue;
        }
        (ariaAttributes ??= []).push({ attribute: attribute as EsTreeNode, propName });
      }
      if (!ariaAttributes) return;

      const elementType = getElementType(node, context.settings);
      const roleAttribute = hasJsxPropIgnoreCase(node.attributes, "role");
      // Static resolution covers `role={cond ? "row" : "gridcell"}` and
      // const-bound roles, not just the literal. The diagnostic claims the
      // prop is ignored, so it must hold for EVERY candidate: all resolved
      // roles have to be known and all have to lack support for the prop.
      const roleCandidates = roleAttribute
        ? getJsxPropStaticStringValues(roleAttribute, context.scopes)
        : [getImplicitRole(node, elementType, context.scopes)].filter(
            (role): role is string => role !== null,
          );
      if (roleCandidates === null || roleCandidates.length === 0) return;
      const supportedSets: Array<ReadonlySet<string>> = [];
      for (const role of roleCandidates) {
        if (!VALID_ARIA_ROLES.has(role)) return;
        const supported = ROLE_SUPPORTS_ARIA_PROPS[role];
        if (!supported) return;
        supportedSets.push(supported);
      }
      const isImplicit = !roleAttribute;

      for (const { attribute, propName } of ariaAttributes) {
        if (supportedSets.some((supported) => supported.has(propName))) continue;
        context.report({
          node: attribute,
          message: isImplicit
            ? buildMessageImplicit(roleCandidates[0], propName, elementType)
            : buildMessageDefault(roleCandidates, propName),
        });
      }
    },
  }),
});
