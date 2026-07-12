import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findVariableInitializer } from "./find-variable-initializer.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isUppercaseName } from "./is-uppercase-name.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const resolveConstantStringBinding = (name: EsTreeNodeOfType<"JSXIdentifier">): string | null => {
  const binding = findVariableInitializer(name, name.name);
  if (!binding?.initializer) return null;

  const declarator = binding.bindingIdentifier.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return null;
  if (declarator.id !== binding.bindingIdentifier) return null;

  const declaration = declarator.parent;
  if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) return null;
  if (declaration.kind !== "const") return null;

  const initializer = stripParenExpression(binding.initializer);
  return isNodeOfType(initializer, "Literal") && typeof initializer.value === "string"
    ? initializer.value
    : null;
};

const flattenJsxName = (name: EsTreeNode): string => {
  if (isNodeOfType(name, "JSXIdentifier")) return name.name;
  if (isNodeOfType(name, "JSXMemberExpression")) {
    return `${flattenJsxName(name.object)}.${name.property.name}`;
  }
  if (isNodeOfType(name, "JSXNamespacedName")) {
    return `${name.namespace.name}:${name.name.name}`;
  }
  return "";
};

export const resolveJsxElementType = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): string => {
  const name = openingElement.name;
  if (isNodeOfType(name, "JSXIdentifier")) {
    if (!isUppercaseName(name.name)) return name.name;
    return resolveConstantStringBinding(name) ?? name.name;
  }
  return flattenJsxName(name);
};
