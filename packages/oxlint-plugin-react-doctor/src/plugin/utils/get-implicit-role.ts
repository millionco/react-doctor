import { VALID_ARIA_ROLES } from "../constants/aria-roles.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getJsxPropStringValue } from "./get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "./has-jsx-prop-ignore-case.js";

// Port of `get_implicit_role` from OXC. Returns the implicit ARIA
// role for an HTML element, or null if there isn't one.
export const getImplicitRole = (
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
