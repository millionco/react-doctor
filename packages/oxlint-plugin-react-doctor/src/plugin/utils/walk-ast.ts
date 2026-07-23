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

// HACK: AST is acyclic except for `parent` back-references, which we skip.
// Visitors may return `false` to prune the subtree below `node` (e.g. to
// stop walking into nested functions when collecting `await` expressions
// for the enclosing function only). Returning anything else (including
// `undefined`, the natural value of statements) continues the walk.
// Uses an explicit stack to avoid stack overflow on deeply nested ASTs.
export const walkAst = (node: EsTreeNode, visitor: (child: EsTreeNode) => boolean | void): void => {
  if (!node || typeof node !== "object") return;
  const stack: EsTreeNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (visitor(current) === false) continue;
    const children: EsTreeNode[] = [];
    forEachChildNode(current, (child) => children.push(child));
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push(children[i]);
    }
  }
};
