import { FETCH_CALLEE_NAMES, FETCH_MEMBER_OBJECTS } from "../constants/library.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { collectEffectInvokedFunctions } from "./collect-effect-invoked-functions.js";
import { isFunctionLike } from "./is-function-like.js";
import { walkAst } from "./walk-ast.js";
import { isNodeOfType } from "./is-node-of-type.js";

interface ContainsFetchCallOptions {
  // Prune the walk at nested function boundaries so only fetches that run as
  // part of executing `node` match: its own body plus nested functions the
  // body invokes (IIFEs, called local functions, promise-chain callbacks),
  // skipping handlers registered for a later user interaction.
  stopAtFunctionBoundary?: boolean;
}

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
