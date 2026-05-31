import { ARIA_PROPERTIES } from "../../constants/aria-properties.js";
import { VALID_ARIA_ROLES } from "../../constants/aria-roles.js";
import { ROLE_SUPPORTS_ARIA_PROPS } from "../../constants/role-supports-aria-props.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const buildMessageDefault = (role: string, propName: string): string =>
  `Screen reader users get no help from \`${propName}\` because role \`${role}\` ignores it, so remove it or change the role.`;

const buildMessageImplicit = (role: string, propName: string, elementType: string): string =>
  `Screen reader users get no help from \`${propName}\` because \`${elementType}\` has role \`${role}\`, which ignores it, so remove \`${propName}\` or change the element.`;

// Port of `get_implicit_role` from OXC. Returns the implicit ARIA
// role for an HTML element, or null if there isn't one.
const getImplicitRole = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  elementType: string,
): string | null => {
  const propStringValue = (propName: string): string | null => {
    const attribute = hasJsxPropIgnoreCase(node.attributes, propName);
    return attribute ? getJsxPropStringValue(attribute) : null;
  };

  let implicit: string = "";
  switch (elementType) {
    case "a":
    case "area":
    case "link": {
      implicit = hasJsxPropIgnoreCase(node.attributes, "href") ? "link" : "";
      break;
    }
    case "article":
      implicit = "article";
      break;
    case "aside":
      implicit = "complementary";
      break;
    case "body":
      implicit = "document";
      break;
    case "button":
      implicit = "button";
      break;
    case "datalist":
    case "select":
      implicit = "listbox";
      break;
    case "details":
      implicit = "group";
      break;
    case "dialog":
      implicit = "dialog";
      break;
    case "form":
      implicit = "form";
      break;
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      implicit = "heading";
      break;
    case "hr":
      implicit = "separator";
      break;
    case "img": {
      const altAttribute = hasJsxPropIgnoreCase(node.attributes, "alt");
      if (!altAttribute) {
        implicit = "img";
      } else {
        const value = getJsxPropStringValue(altAttribute);
        implicit = value === null ? "img" : value === "" ? "" : "img";
      }
      break;
    }
    case "input": {
      const inputType = propStringValue("type");
      if (inputType === null) implicit = "textbox";
      else if (
        inputType === "button" ||
        inputType === "image" ||
        inputType === "reset" ||
        inputType === "submit"
      )
        implicit = "button";
      else if (inputType === "checkbox") implicit = "checkbox";
      else if (inputType === "radio") implicit = "radio";
      else if (inputType === "range") implicit = "slider";
      else implicit = "textbox";
      break;
    }
    case "li":
      implicit = "listitem";
      break;
    case "menu": {
      const menuType = propStringValue("type");
      implicit = menuType === "toolbar" ? "toolbar" : "";
      break;
    }
    case "menuitem": {
      const menuitemType = propStringValue("type");
      implicit =
        menuitemType === "checkbox"
          ? "menuitemcheckbox"
          : menuitemType === "command"
            ? "menuitem"
            : menuitemType === "radio"
              ? "menuitemradio"
              : "";
      break;
    }
    case "meter":
    case "progress":
      implicit = "progressbar";
      break;
    case "nav":
      implicit = "navigation";
      break;
    case "ol":
    case "ul":
      implicit = "list";
      break;
    case "option":
      implicit = "option";
      break;
    case "output":
      implicit = "status";
      break;
    case "section":
      implicit = "region";
      break;
    case "tbody":
    case "tfoot":
    case "thead":
      implicit = "rowgroup";
      break;
    case "textarea":
      implicit = "textbox";
      break;
    default:
      implicit = "";
  }
  return implicit && VALID_ARIA_ROLES.has(implicit) ? implicit : null;
};

// Port of `oxc_linter::rules::jsx_a11y::role_supports_aria_props`.
// Reports `aria-*` props that aren't supported by the element's
// effective ARIA role (explicit > implicit).
export const roleSupportsAriaProps = defineRule<Rule>({
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
