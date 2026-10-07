import type { EsTreeNode } from "./es-tree-node.js";

const TYPESCRIPT_EXPRESSION_WRAPPER_TYPES = new Set([
  "TSAsExpression",
  "TSInstantiationExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

export const isTypeScriptTypePosition = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (!parent?.type.startsWith("TS")) return false;
  if (!TYPESCRIPT_EXPRESSION_WRAPPER_TYPES.has(parent.type)) return true;
  return !("expression" in parent && parent.expression === node);
};
