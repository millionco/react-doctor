import type { EsTreeNode } from "./es-tree-node.js";
import { isHookBindingInScope } from "./is-hook-binding-in-scope.js";

// Convenience wrapper: verifies `setterName` was destructured at
// index 1 from a `useState()` call in an enclosing scope.
export const isUseStateSetterInScope = (node: EsTreeNode, setterName: string): boolean =>
  isHookBindingInScope(node, {
    bindingName: setterName,
    hookName: "useState",
    destructureIndex: 1,
  });
