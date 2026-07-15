import { VALID_ARIA_ROLES } from "../constants/aria-roles.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getJsxPropStaticStringValues } from "./get-jsx-prop-static-string-values.js";
import { getJsxPropStringValue } from "./get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "./has-jsx-prop-ignore-case.js";

const getInputTypeImplicitRole = (inputTypeValue: string): string => {
  const inputType = inputTypeValue.toLowerCase();
  if (
    inputType === "button" ||
    inputType === "image" ||
    inputType === "reset" ||
    inputType === "submit"
  ) {
    return "button";
  }
  if (inputType === "checkbox") return "checkbox";
  if (inputType === "number") return "spinbutton";
  if (inputType === "radio") return "radio";
  if (inputType === "range") return "slider";
  return "textbox";
};

// Port of `get_implicit_role` from OXC. Returns the implicit ARIA
// role for an HTML element, or null if there isn't one.
export const getImplicitRole = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  elementType: string,
  scopes: ScopeAnalysis,
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
      const inputTypeAttribute = hasJsxPropIgnoreCase(node.attributes, "type");
      if (!inputTypeAttribute) {
        implicit = "textbox";
        break;
      }
      const inputTypeValues = getJsxPropStaticStringValues(inputTypeAttribute, scopes);
      if (inputTypeValues === null) {
        implicit = "";
        break;
      }
      const implicitRoles = new Set(inputTypeValues.map(getInputTypeImplicitRole));
      implicit = implicitRoles.size === 1 ? (implicitRoles.values().next().value ?? "") : "";
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
