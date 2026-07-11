import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { readInitialStateBoolean } from "./read-initial-state-boolean.js";

// True when `node` only renders once a `useState(falsyLiteral)` flag has
// flipped truthy — that flip can only happen after hydration, so the gated
// branch cannot appear in the server-vs-first-client-render comparison.
export const isGatedByFalsyInitialState = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let cursor: EsTreeNode = node;
  let parent: EsTreeNode | null | undefined = node.parent;
  while (parent) {
    if (
      isNodeOfType(parent, "LogicalExpression") &&
      parent.operator === "&&" &&
      parent.right === cursor &&
      readInitialStateBoolean(parent.left, scopes) === false
    ) {
      return true;
    }
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      ((parent.consequent === cursor && readInitialStateBoolean(parent.test, scopes) === false) ||
        (parent.alternate === cursor && readInitialStateBoolean(parent.test, scopes) === true))
    ) {
      return true;
    }
    if (
      isNodeOfType(parent, "IfStatement") &&
      ((parent.consequent === cursor && readInitialStateBoolean(parent.test, scopes) === false) ||
        (parent.alternate === cursor && readInitialStateBoolean(parent.test, scopes) === true))
    ) {
      return true;
    }
    cursor = parent;
    parent = parent.parent ?? null;
  }
  return false;
};
