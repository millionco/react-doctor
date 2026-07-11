import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";

export const resolveStaticOnceOption = (
  optionsNode: EsTreeNode | null | undefined,
): boolean | null => {
  if (!optionsNode) return false;
  const unwrappedOptions = stripParenExpression(optionsNode);
  if (isNodeOfType(unwrappedOptions, "Literal")) {
    return typeof unwrappedOptions.value === "boolean" ? false : null;
  }
  if (!isNodeOfType(unwrappedOptions, "ObjectExpression")) return null;

  let once = false;
  for (const property of unwrappedOptions.properties) {
    if (!isNodeOfType(property, "Property")) return null;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (propertyName === null || (!property.computed && propertyName === "__proto__")) {
      return null;
    }
    if (propertyName !== "once") continue;
    const propertyValue = stripParenExpression(property.value);
    if (!isNodeOfType(propertyValue, "Literal") || typeof propertyValue.value !== "boolean") {
      return null;
    }
    once = propertyValue.value;
  }
  return once;
};
