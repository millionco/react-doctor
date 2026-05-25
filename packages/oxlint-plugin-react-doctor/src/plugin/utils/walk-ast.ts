import type { EsTreeNode } from "./es-tree-node.js";
import { isAstNode } from "./is-ast-node.js";

export interface WalkAstOptions {
  readonly skipKeys?: ReadonlySet<string>;
}

const PARENT_KEY = "parent";

// HACK: AST is acyclic except for `parent` back-references, which we skip.
// Visitors may return `false` to prune the subtree below `node` (e.g. to
// stop walking into nested functions when collecting `await` expressions
// for the enclosing function only). Returning anything else (including
// `undefined`, the natural value of statements) continues the walk.
export const walkAst = (
  node: EsTreeNode,
  visitor: (child: EsTreeNode) => boolean | void,
  options: WalkAstOptions = {},
): void => {
  if (!node || typeof node !== "object") return;
  if (visitor(node) === false) return;
  const skipKeys = options.skipKeys;
  const nodeRecord = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(nodeRecord)) {
    if (key === PARENT_KEY || skipKeys?.has(key)) continue;
    const child = nodeRecord[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isAstNode(item)) walkAst(item, visitor, options);
      }
    } else if (isAstNode(child)) {
      walkAst(child, visitor, options);
    }
  }
};
