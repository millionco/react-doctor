import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isUppercaseName } from "./is-uppercase-name.js";

// A function-expression / arrow whose binding — reached through any
// wrapping calls (`memo(forwardRef(() => …))`) — is a PascalCase variable
// or a default export. That binding is what makes it a component.
const isFunctionAssignedToComponent = (functionNode: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null = functionNode.parent ?? null;
  while (isNodeOfType(cursor, "CallExpression")) {
    cursor = cursor.parent ?? null;
  }
  if (
    isNodeOfType(cursor, "VariableDeclarator") &&
    isNodeOfType(cursor.id, "Identifier") &&
    isUppercaseName(cursor.id.name)
  ) {
    return true;
  }
  return isNodeOfType(cursor, "ExportDefaultDeclaration");
};

// True when a function-like node is a React component: a PascalCase (or
// anonymous / default-exported) function declaration, or an arrow /
// function expression bound to a PascalCase variable or default export.
// A lowercase-named helper (`renderRow`, `formatDate`) is NOT a component,
// so its parameters are ordinary locals, not props.
export const isComponentFunction = (node: EsTreeNode): boolean => {
  if (!isFunctionLike(node)) return false;
  if (isNodeOfType(node, "FunctionDeclaration")) {
    return (
      !node.id ||
      node.id.name === "default" ||
      isUppercaseName(node.id.name) ||
      isNodeOfType(node.parent, "ExportDefaultDeclaration")
    );
  }
  return isFunctionAssignedToComponent(node);
};
