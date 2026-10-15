import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";

const REACT_RENDER_CALLBACK_APIS = new Set(["useState", "useMemo", "startTransition"]);

export const isProvenSynchronousRenderCallback = (
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isFunctionLike(callback) || callback.async || callback.generator) return false;
  const callbackRoot = findTransparentExpressionRoot(callback);
  const call = callbackRoot.parent;
  if (!isNodeOfType(call, "CallExpression")) return false;
  return (
    call.callee === callbackRoot ||
    (call.arguments[0] === callbackRoot &&
      isProvenUnmodifiedReactApiCall(call, REACT_RENDER_CALLBACK_APIS, scopes))
  );
};
