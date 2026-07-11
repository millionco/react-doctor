import type { EsTreeNode } from "./es-tree-node.js";
import { isAstNode } from "./is-ast-node.js";
import { RUNTIME_VISITOR_KEYS } from "./runtime-visitor-keys.js";

// HACK: AST is acyclic except for `parent` back-references, which we skip.
// Visitors may return `false` to prune the subtree below `node` (e.g. to
// stop walking into nested functions when collecting `await` expressions
// for the enclosing function only). Returning anything else (including
// `undefined`, the natural value of statements) continues the walk.
export const walkAst = (node: EsTreeNode, visitor: (child: EsTreeNode) => boolean | void): void => {
  if (visitor(node) === false) return;
  const nodeRecord = node as unknown as Record<string, unknown>;
  const childKeys = RUNTIME_VISITOR_KEYS[node.type];
  if (childKeys !== undefined) {
    for (let keyIndex = 0; keyIndex < childKeys.length; keyIndex += 1) {
      const child = nodeRecord[childKeys[keyIndex]];
      if (Array.isArray(child)) {
        for (let itemIndex = 0; itemIndex < child.length; itemIndex += 1) {
          const item = child[itemIndex];
          if (isAstNode(item)) walkAst(item, visitor);
        }
      } else if (isAstNode(child)) {
        walkAst(child, visitor);
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
        if (isAstNode(item)) walkAst(item, visitor);
      }
    } else if (isAstNode(child)) {
      walkAst(child, visitor);
    }
  }
};
