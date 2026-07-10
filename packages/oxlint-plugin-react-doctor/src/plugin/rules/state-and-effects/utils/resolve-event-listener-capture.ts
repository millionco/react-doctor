import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";

export const resolveEventListenerCapture = (
  optionsNode: EsTreeNode | null | undefined,
): boolean | null => {
  if (!optionsNode) return false;
  const unwrappedOptions = stripParenExpression(optionsNode);
  if (isNodeOfType(unwrappedOptions, "Literal")) {
    return typeof unwrappedOptions.value === "boolean" ? unwrappedOptions.value : null;
  }
  if (!isNodeOfType(unwrappedOptions, "ObjectExpression")) return null;

  let capture = false;
  for (const property of unwrappedOptions.properties) {
    if (!isNodeOfType(property, "Property")) return null;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (propertyName === null) return null;
    if (!property.computed && propertyName === "__proto__") return null;
    if (propertyName !== "capture") continue;
    const propertyValue = stripParenExpression(property.value);
    if (!isNodeOfType(propertyValue, "Literal") || typeof propertyValue.value !== "boolean") {
      return null;
    }
    capture = propertyValue.value;
  }
  return capture;
};
