import { HTML_TAGS } from "../constants/html-tags.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isAstNode } from "./is-ast-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { TRANSPARENT_EXPRESSION_WRAPPER_TYPES } from "./strip-paren-expression.js";

export interface IntrinsicJsxScanBudget {
  remainingNodes: number;
}

export interface ClosedIntrinsicJsxOptions {
  readonly childName?: string;
  readonly indexName?: string;
}

export interface ClosedIntrinsicJsxTreeProof {
  readonly hasItemChild: boolean;
}

interface IntrinsicJsxScanEntry {
  readonly node: EsTreeNode;
  readonly position: "element" | "child" | "child-value" | "attribute" | "attribute-value";
  readonly attributeName?: string;
}

export const getClosedIntrinsicJsxTreeProof = (
  expression: EsTreeNode,
  budget: IntrinsicJsxScanBudget,
  options: ClosedIntrinsicJsxOptions = {},
): ClosedIntrinsicJsxTreeProof | null => {
  const pending: IntrinsicJsxScanEntry[] = [{ node: expression, position: "element" }];
  let hasItemChild = false;
  while (pending.length > 0) {
    if (budget.remainingNodes <= 0) return null;
    budget.remainingNodes -= 1;
    const entry = pending.pop();
    if (!entry) return null;
    const { node, position, attributeName } = entry;
    if (TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(node.type)) {
      if (!("expression" in node) || !isAstNode(node.expression)) return null;
      pending.push({ node: node.expression, position, attributeName });
      continue;
    }
    if (position === "attribute") {
      if (!isNodeOfType(node, "JSXAttribute") || !isNodeOfType(node.name, "JSXIdentifier"))
        return null;
      if (node.name.name === "ref") return null;
      if (node.value)
        pending.push({
          node: node.value,
          position: "attribute-value",
          attributeName: node.name.name,
        });
      continue;
    }
    if (position === "attribute-value") {
      if (isNodeOfType(node, "Literal")) continue;
      if (isNodeOfType(node, "JSXExpressionContainer")) {
        pending.push({ node: node.expression, position, attributeName });
        continue;
      }
      if (
        attributeName === "key" &&
        isNodeOfType(node, "Identifier") &&
        node.name === options.indexName
      )
        continue;
      return null;
    }
    if (position === "child" && isNodeOfType(node, "JSXText")) continue;
    if (position === "child" && isNodeOfType(node, "JSXExpressionContainer")) {
      pending.push({ node: node.expression, position: "child-value" });
      continue;
    }
    if (position === "child-value") {
      if (isNodeOfType(node, "Literal")) continue;
      if (isNodeOfType(node, "Identifier") && node.name === options.childName) {
        hasItemChild = true;
        continue;
      }
    }
    if (!isNodeOfType(node, "JSXElement")) return null;
    const opening = node.openingElement;
    if (!isNodeOfType(opening.name, "JSXIdentifier") || !HTML_TAGS.has(opening.name.name))
      return null;
    for (const attribute of opening.attributes) {
      if (pending.length >= budget.remainingNodes) return null;
      pending.push({ node: attribute, position: "attribute" });
    }
    for (const child of node.children) {
      if (pending.length >= budget.remainingNodes) return null;
      pending.push({ node: child, position: "child" });
    }
  }
  return { hasItemChild };
};
