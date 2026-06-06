import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

/**
 * Type-guard for the two single-node JSX output forms: `JSXElement`
 * (`<Foo />`) and `JSXFragment` (`<>…</>`). Canonical home for the
 * `isNodeOfType(x, "JSXElement") || isNodeOfType(x, "JSXFragment")` check
 * that many rules otherwise inline. Does NOT unwrap parens / TS wrappers —
 * callers that need the semantic expression should `stripParenExpression`
 * first.
 */
export const isJsxElementOrFragment = (
  node: EsTreeNode | null | undefined,
): node is EsTreeNodeOfType<"JSXElement"> | EsTreeNodeOfType<"JSXFragment"> =>
  Boolean(node && (isNodeOfType(node, "JSXElement") || isNodeOfType(node, "JSXFragment")));
