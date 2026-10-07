import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getEffectiveObjectPropertiesInInsertionOrder } from "../../../utils/get-effective-object-properties-in-insertion-order.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { resolveStableOptionsObject } from "../../../utils/resolve-stable-options-object.js";
import type { RuleContext } from "../../../utils/rule-context.js";

export const resolveStaticShaderUniformsObject = (
  expression: EsTreeNode,
  referenceNode: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  const initialObject = resolveStableOptionsObject(expression, [], context.scopes, referenceNode);
  if (!initialObject) return null;
  const properties = getEffectiveObjectPropertiesInInsertionOrder(initialObject.properties);
  if (!properties) return null;
  const propertyNames = properties
    .map((property) => getStaticPropertyKeyName(property, { allowComputedString: true }))
    .filter((propertyName): propertyName is string => propertyName !== null);
  if (propertyNames.length !== properties.length) return null;
  return resolveStableOptionsObject(expression, propertyNames, context.scopes, referenceNode);
};
