import { GLOBAL_ARIA_PROPERTIES } from "../constants/global-aria-properties.js";
import { PROHIBITED_ARIA_PROPERTIES_BY_ROLE } from "../constants/prohibited-aria-properties-by-role.js";
import { ROLE_SUPPORTS_ARIA_PROPS } from "../constants/role-supports-aria-props.js";

export const isAriaPropertySupportedByRole = (role: string, property: string): boolean => {
  if (PROHIBITED_ARIA_PROPERTIES_BY_ROLE[role]?.has(property)) return false;
  return (
    ROLE_SUPPORTS_ARIA_PROPS[role]?.has(property) === true || GLOBAL_ARIA_PROPERTIES.has(property)
  );
};
