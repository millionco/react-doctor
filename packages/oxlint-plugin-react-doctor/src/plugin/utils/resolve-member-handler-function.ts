import { findVariableInitializer } from "./find-variable-initializer.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getPropertyKeyName } from "./get-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

const asHandlerFunction = (
  value: EsTreeNode | null | undefined,
): EsTreeNodeOfType<"FunctionExpression" | "ArrowFunctionExpression"> | undefined => {
  if (isNodeOfType(value, "FunctionExpression") || isNodeOfType(value, "ArrowFunctionExpression")) {
    return value;
  }
  return undefined;
};

const resolveFromClassBody = (
  classBody: EsTreeNodeOfType<"ClassBody">,
  propertyName: string,
): EsTreeNodeOfType<"FunctionExpression" | "ArrowFunctionExpression"> | undefined => {
  for (const classElement of classBody.body) {
    if (
      !isNodeOfType(classElement, "MethodDefinition") &&
      !isNodeOfType(classElement, "PropertyDefinition")
    ) {
      continue;
    }
    if (getPropertyKeyName(classElement.key) !== propertyName) continue;
    const resolvedHandler = asHandlerFunction(classElement.value);
    if (resolvedHandler) return resolvedHandler;
  }
  return undefined;
};

const resolveFromObjectExpression = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
  propertyName: string,
): EsTreeNodeOfType<"FunctionExpression" | "ArrowFunctionExpression"> | undefined => {
  for (const objectProperty of objectExpression.properties) {
    if (!isNodeOfType(objectProperty, "Property")) continue;
    if (getPropertyKeyName(objectProperty.key) !== propertyName) continue;
    const resolvedHandler = asHandlerFunction(objectProperty.value);
    if (resolvedHandler) return resolvedHandler;
  }
  return undefined;
};

export const resolveMemberHandlerFunction = (
  handler: EsTreeNodeOfType<"MemberExpression">,
): EsTreeNodeOfType<"FunctionExpression" | "ArrowFunctionExpression"> | undefined => {
  const propertyName = getPropertyKeyName(handler.property);
  if (propertyName === undefined) return undefined;
  const objectNode = handler.object;

  if (isNodeOfType(objectNode, "ThisExpression")) {
    let ancestor: EsTreeNode | null | undefined = handler.parent;
    while (ancestor) {
      if (isNodeOfType(ancestor, "ClassBody")) {
        return resolveFromClassBody(ancestor, propertyName);
      }
      if (isNodeOfType(ancestor, "ObjectExpression")) {
        const resolvedHandler = resolveFromObjectExpression(ancestor, propertyName);
        if (resolvedHandler) return resolvedHandler;
      }
      ancestor = ancestor.parent;
    }
    return undefined;
  }

  if (isNodeOfType(objectNode, "Identifier")) {
    const binding = findVariableInitializer(objectNode, objectNode.name);
    if (isNodeOfType(binding?.initializer, "ObjectExpression")) {
      return resolveFromObjectExpression(binding.initializer, propertyName);
    }
  }

  return undefined;
};
