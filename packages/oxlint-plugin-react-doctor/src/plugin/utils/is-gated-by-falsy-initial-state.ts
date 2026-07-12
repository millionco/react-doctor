import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { readInitialStateBoolean } from "./read-initial-state-boolean.js";

// True when a proven initial condition short-circuits the path to `node` on
// both the server and first client render.
export const isGatedByFalsyInitialState = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let cursor: EsTreeNode = node;
  let parent: EsTreeNode | null | undefined = node.parent;
  while (parent) {
    if (
      isNodeOfType(parent, "LogicalExpression") &&
      parent.right === cursor &&
      ((parent.operator === "&&" && readInitialStateBoolean(parent.left, scopes) === false) ||
        (parent.operator === "||" && readInitialStateBoolean(parent.left, scopes) === true))
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
