import { FETCH_CALLEE_NAMES, FETCH_MEMBER_OBJECTS } from "../constants/library.js";
import { collectEffectInvokedFunctions } from "./collect-effect-invoked-functions.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

interface ContainsFetchCallOptions {
  // Prune the walk at nested function boundaries so only fetches that run as
  // part of executing `node` match: its own body plus nested functions the
  // body invokes (async IIFEs, called local functions like
  // `async function loadData(){...} loadData()` or
  // `const loadData = async () => {...}; void loadData()`, and promise-chain
  // callbacks), skipping handlers registered for a later user interaction and
  // the returned cleanup function.
  stopAtFunctionBoundary?: boolean;
}

const isFetchCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (isNodeOfType(node.callee, "Identifier") && FETCH_CALLEE_NAMES.has(node.callee.name)) {
    return true;
  }
  return (
    isNodeOfType(node.callee, "MemberExpression") &&
    isNodeOfType(node.callee.object, "Identifier") &&
    FETCH_MEMBER_OBJECTS.has(node.callee.object.name)
  );
};

export const containsFetchCall = (
  node: EsTreeNode,
  options?: ContainsFetchCallOptions,
): boolean => {
  const effectInvokedFunctions = options?.stopAtFunctionBoundary
    ? collectEffectInvokedFunctions(node)
    : null;
  let didFindFetchCall = false;
  walkAst(node, (child) => {
    if (
      effectInvokedFunctions &&
      child !== node &&
      isFunctionLike(child) &&
      !effectInvokedFunctions.has(child)
    ) {
      return false;
    }
    if (isFetchCall(child)) didFindFetchCall = true;
  });
  return didFindFetchCall;
};
