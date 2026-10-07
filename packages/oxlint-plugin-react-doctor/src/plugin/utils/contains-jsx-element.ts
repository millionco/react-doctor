import type { EsTreeNode } from "./es-tree-node.js";
import { someAst } from "./some-ast.js";

/**
 * True when `root` or any descendant in its subtree is a `JSXElement`
 * or `JSXFragment`. Walks the AST without `parent` traversal.
 *
 * Used by `prefer-function-component` and `jsx-filename-extension`
 * to recognise component bodies that render JSX. The richer variants
 * in `display-name.ts` (which also recognises `createElement(...)`
 * calls) and `no-multi-comp.ts` (which additionally stops at nested
 * function / class boundaries) layer extra predicates on top of this
 * base scan — they keep their own implementations because the
 * augmentation isn't easily expressible as a composition.
 */
export const containsJsxElement = (root: EsTreeNode): boolean => {
  return someAst(root, (node) => node.type === "JSXElement" || node.type === "JSXFragment");
};
