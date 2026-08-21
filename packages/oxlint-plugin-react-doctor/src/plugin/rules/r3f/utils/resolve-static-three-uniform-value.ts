import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getEffectiveObjectPropertiesInInsertionOrder } from "../../../utils/get-effective-object-properties-in-insertion-order.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveStableOptionsObject } from "../../../utils/resolve-stable-options-object.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { getThreeConstructorName } from "./get-three-constructor-name.js";

export interface StaticThreeUniformValue {
  readonly expression: EsTreeNode | null;
}

export const resolveStaticThreeUniformValue = (
  expression: EsTreeNode,
  referenceNode: EsTreeNode,
  context: RuleContext,
): StaticThreeUniformValue | null => {
  if (getThreeConstructorName(expression, context.scopes) === "Uniform") {
    if (!isNodeOfType(expression, "NewExpression")) return null;
    const value = expression.arguments[0];
    return { expression: value && !isNodeOfType(value, "SpreadElement") ? value : null };
  }
  const definitionObject = resolveStableOptionsObject(
    expression,
    ["value"],
    context.scopes,
    referenceNode,
  );
  if (!definitionObject) return null;
  const properties = getEffectiveObjectPropertiesInInsertionOrder(definitionObject.properties);
  if (!properties) return null;
  const valueProperty = properties.find(
    (property) =>
      property.kind === "init" &&
      !property.method &&
      getStaticPropertyKeyName(property, { allowComputedString: true }) === "value",
  );
  return valueProperty ? { expression: valueProperty.value } : null;
};
