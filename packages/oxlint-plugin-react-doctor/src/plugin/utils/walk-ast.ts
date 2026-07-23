import type { EsTreeNode } from "./es-tree-node.js";
import { isAstNode } from "./is-ast-node.js";
import { RUNTIME_VISITOR_KEYS } from "./runtime-visitor-keys.js";

// Visits every AST child of `node` (skipping `parent` back-references and
// inherited keys) without visiting `node` itself. Known node types iterate
// their visitor keys; unknown types fall back to own-key iteration.
export const forEachChildNode = (node: EsTreeNode, visit: (child: EsTreeNode) => void): void => {
  const nodeRecord = node as unknown as Record<string, unknown>;
  const childKeys = RUNTIME_VISITOR_KEYS[node.type];
  if (childKeys !== undefined) {
    for (let keyIndex = 0; keyIndex < childKeys.length; keyIndex += 1) {
      const child = nodeRecord[childKeys[keyIndex]];
      if (Array.isArray(child)) {
        for (let itemIndex = 0; itemIndex < child.length; itemIndex += 1) {
          const item = child[itemIndex];
          if (isAstNode(item)) visit(item);
        }
      } else if (isAstNode(child)) {
        visit(child);
      }
    }
    return;
  }
  for (const key in nodeRecord) {
    if (key === "parent" || !Object.hasOwn(nodeRecord, key)) continue;
    const child = nodeRecord[key];
    if (Array.isArray(child)) {
      for (let itemIndex = 0; itemIndex < child.length; itemIndex += 1) {
        const item = child[itemIndex];
        if (isAstNode(item)) visit(item);
      }
    } else if (isAstNode(child)) {
      visit(child);
    }
  }
};

// HACK: The explicit stack avoids overflowing the JavaScript call stack on
// deeply nested ASTs. AST is acyclic except for `parent` back-references,
// which we skip.
// Visitors may return `false` to prune the subtree below `node` (e.g. to
// stop walking into nested functions when collecting `await` expressions
// for the enclosing function only). Returning anything else (including
// `undefined`, the natural value of statements) continues the walk.
export const walkAst = (node: EsTreeNode, visitor: (child: EsTreeNode) => boolean | void): void => {
  if (!node || typeof node !== "object") return;
  const pendingNodes: EsTreeNode[] = [node];
  while (pendingNodes.length > 0) {
    const currentNode = pendingNodes.pop();
    if (currentNode === undefined || visitor(currentNode) === false) continue;
    const childNodes: EsTreeNode[] = [];
    forEachChildNode(currentNode, (childNode) => childNodes.push(childNode));
    for (let childIndex = childNodes.length - 1; childIndex >= 0; childIndex -= 1) {
      pendingNodes.push(childNodes[childIndex]);
    }
  }
};
