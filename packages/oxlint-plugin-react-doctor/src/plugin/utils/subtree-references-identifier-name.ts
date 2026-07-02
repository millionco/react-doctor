import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

// True when any `Identifier` anywhere in `node`'s subtree has a name equal to
// `names` (single string) or contained in `names` (set). Uses `walkAst`, so
// `parent` back-references are skipped and the whole subtree is covered.
export const subtreeReferencesIdentifierName = (
  node: EsTreeNode | null | undefined,
  names: string | ReadonlySet<string>,
): boolean => {
  if (!node) return false;
  const isMatch =
    typeof names === "string"
      ? (candidate: string): boolean => candidate === names
      : (candidate: string): boolean => names.has(candidate);
  let found = false;
  walkAst(node, (child: EsTreeNode) => {
    if (found) return false;
    if (isNodeOfType(child, "Identifier") && isMatch(child.name)) {
      found = true;
      return false;
    }
  });
  return found;
};
