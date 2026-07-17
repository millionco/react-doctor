import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getStaticJsxText = (node: EsTreeNode | null | undefined): string => {
  if (!node) return "";
  if (isNodeOfType(node, "JSXText")) return node.value ?? "";
  if (isNodeOfType(node, "Literal")) return typeof node.value === "string" ? node.value : "";
  if (isNodeOfType(node, "TemplateLiteral")) {
    return (node.quasis ?? []).map((quasi) => quasi.value?.raw ?? "").join(" ");
  }
  if (isNodeOfType(node, "JSXExpressionContainer")) return getStaticJsxText(node.expression);
  if (isNodeOfType(node, "JSXElement") || isNodeOfType(node, "JSXFragment")) {
    return (node.children ?? []).map(getStaticJsxText).join(" ");
  }
  if (isNodeOfType(node, "ConditionalExpression")) {
    return `${getStaticJsxText(node.consequent)} ${getStaticJsxText(node.alternate)}`;
  }
  if (isNodeOfType(node, "LogicalExpression")) return getStaticJsxText(node.right);
  return "";
};
