import type { EsTreeNode } from "./es-tree-node.js";
import { isUppercaseName } from "./is-uppercase-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isComponentAssignment = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "VariableDeclarator") &&
  isNodeOfType(node.id, "Identifier") &&
  isUppercaseName(node.id.name) &&
  Boolean(node.init) &&
  (isNodeOfType(node.init, "ArrowFunctionExpression") ||
    isNodeOfType(node.init, "FunctionExpression"));
