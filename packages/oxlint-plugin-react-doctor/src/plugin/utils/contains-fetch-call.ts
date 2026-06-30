import { FETCH_CALLEE_NAMES, FETCH_MEMBER_OBJECTS } from "../constants/library.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { walkAst } from "./walk-ast.js";
import { isNodeOfType } from "./is-node-of-type.js";

interface ContainsFetchCallOptions {
  // Prune the walk at nested function boundaries so only fetches that run
  // synchronously in `node`'s own body match (skipping event handlers and
  // callbacks declared inside it, which run on a later user interaction).
  stopAtFunctionBoundary?: boolean;
}

export const containsFetchCall = (
  node: EsTreeNode,
  options?: ContainsFetchCallOptions,
): boolean => {
  let didFindFetchCall = false;
  walkAst(node, (child) => {
    if (
      options?.stopAtFunctionBoundary &&
      child !== node &&
      (isNodeOfType(child, "ArrowFunctionExpression") ||
        isNodeOfType(child, "FunctionExpression") ||
        isNodeOfType(child, "FunctionDeclaration"))
    ) {
      return false;
    }
    if (didFindFetchCall || !isNodeOfType(child, "CallExpression")) return;
    if (isNodeOfType(child.callee, "Identifier") && FETCH_CALLEE_NAMES.has(child.callee.name)) {
      didFindFetchCall = true;
    }
    if (
      isNodeOfType(child.callee, "MemberExpression") &&
      isNodeOfType(child.callee.object, "Identifier") &&
      FETCH_MEMBER_OBJECTS.has(child.callee.object.name)
    ) {
      didFindFetchCall = true;
    }
  });
  return didFindFetchCall;
};
