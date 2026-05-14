import { FETCH_CALLEE_NAMES, FETCH_MEMBER_OBJECTS } from "../constants/library.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { walkAst } from "./walk-ast.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const containsFetchCall = (node: EsTreeNode): boolean => {
  let didFindFetchCall = false;
  walkAst(node, (child) => {
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
