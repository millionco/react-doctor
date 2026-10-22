import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isNonReferenceIdentifier = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "MemberExpression")) return parent.property === node && !parent.computed;
  if (isNodeOfType(parent, "Property")) {
    return parent.key === node && !parent.computed && (!parent.shorthand || parent.value !== node);
  }
  if (isNodeOfType(parent, "MethodDefinition") || isNodeOfType(parent, "PropertyDefinition")) {
    return parent.key === node && !parent.computed;
  }
  if (isNodeOfType(parent, "JSXAttribute")) return parent.name === node;
  if (isNodeOfType(parent, "JSXMemberExpression")) return parent.property === node;
  if (isNodeOfType(parent, "ImportSpecifier"))
    return parent.imported === node && parent.local !== node;
  if (isNodeOfType(parent, "ExportSpecifier"))
    return parent.exported === node && parent.local !== node;
  if (
    isNodeOfType(parent, "LabeledStatement") ||
    isNodeOfType(parent, "BreakStatement") ||
    isNodeOfType(parent, "ContinueStatement")
  )
    return parent.label === node;
  return (
    isNodeOfType(node, "JSXIdentifier") &&
    /^[a-z]/.test(node.name) &&
    (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
    parent.name === node
  );
};
