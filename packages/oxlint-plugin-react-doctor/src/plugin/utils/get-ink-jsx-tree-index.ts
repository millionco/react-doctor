import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { forEachChildNode } from "./walk-ast.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveInkJsxElementName } from "./resolve-ink-api-name.js";

export interface InkJsxTreeIndex {
  nearestInkAncestorByNode: WeakMap<EsTreeNode, string | null>;
  nodesContainingInk: WeakSet<EsTreeNode>;
}

interface PendingInkJsxTreeNode {
  nearestInkAncestor: string | null;
  node: EsTreeNode;
}

const inkJsxTreeIndexesByScopes = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNode, InkJsxTreeIndex>
>();

export const getInkJsxTreeIndex = (node: EsTreeNode, scopes: ScopeAnalysis): InkJsxTreeIndex => {
  let indexesByNode = inkJsxTreeIndexesByScopes.get(scopes);
  if (!indexesByNode) {
    indexesByNode = new WeakMap();
    inkJsxTreeIndexesByScopes.set(scopes, indexesByNode);
  }
  const cachedIndex = indexesByNode.get(node);
  if (cachedIndex) return cachedIndex;

  const rootNode = findProgramRoot(node) ?? node;
  const nearestInkAncestorByNode = new WeakMap<EsTreeNode, string | null>();
  const inkOpeningElementNodes = new WeakSet<EsTreeNode>();
  const nodesContainingInk = new WeakSet<EsTreeNode>();
  const visitedNodes: EsTreeNode[] = [];
  const pendingNodes: PendingInkJsxTreeNode[] = [{ nearestInkAncestor: null, node: rootNode }];

  while (pendingNodes.length > 0) {
    const pendingNode = pendingNodes.pop();
    if (pendingNode === undefined) continue;
    const { nearestInkAncestor, node: currentNode } = pendingNode;
    nearestInkAncestorByNode.set(currentNode, nearestInkAncestor);
    visitedNodes.push(currentNode);

    let descendantInkAncestor = nearestInkAncestor;
    if (isNodeOfType(currentNode, "JSXElement")) {
      const inkElementName = resolveInkJsxElementName(currentNode.openingElement, scopes);
      if (inkElementName !== null) {
        inkOpeningElementNodes.add(currentNode.openingElement);
        descendantInkAncestor = inkElementName;
      }
    }
    forEachChildNode(currentNode, (childNode) => {
      pendingNodes.push({ nearestInkAncestor: descendantInkAncestor, node: childNode });
    });
  }

  for (let nodeIndex = visitedNodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
    const currentNode = visitedNodes[nodeIndex];
    if (currentNode === undefined) continue;
    let doesContainInk = inkOpeningElementNodes.has(currentNode);
    if (!doesContainInk) {
      forEachChildNode(currentNode, (childNode) => {
        if (nodesContainingInk.has(childNode)) doesContainInk = true;
      });
    }
    if (doesContainInk) nodesContainingInk.add(currentNode);
  }

  const index = { nearestInkAncestorByNode, nodesContainingInk };
  for (const visitedNode of visitedNodes) indexesByNode.set(visitedNode, index);
  return index;
};
