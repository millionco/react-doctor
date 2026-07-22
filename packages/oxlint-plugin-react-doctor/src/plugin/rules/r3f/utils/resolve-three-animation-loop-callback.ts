import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveRecursiveAnimationFrameCallback } from "../../../utils/resolve-recursive-animation-frame-callback.js";
import { isThreeRendererReference } from "./is-three-renderer-reference.js";
import { resolveLocalReactCallback } from "./resolve-local-react-callback.js";
import { THREE_RENDER_METHOD_NAMES } from "./three-render-method-names.js";
import { walkFunctionExecution } from "./walk-function-execution.js";

const callbackRendersWithThree = (callback: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let doesRenderWithThree = false;
  walkFunctionExecution(callback, scopes, (candidate) => {
    if (
      !doesRenderWithThree &&
      isNodeOfType(candidate, "CallExpression") &&
      isNodeOfType(candidate.callee, "MemberExpression") &&
      THREE_RENDER_METHOD_NAMES.has(getStaticPropertyName(candidate.callee) ?? "") &&
      isThreeRendererReference(candidate.callee.object, scopes)
    ) {
      doesRenderWithThree = true;
    }
  });
  return doesRenderWithThree;
};

export const resolveThreeAnimationLoopCallback = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (
    isNodeOfType(call.callee, "MemberExpression") &&
    getStaticPropertyName(call.callee) === "setAnimationLoop" &&
    isThreeRendererReference(call.callee.object, scopes)
  ) {
    const callbackArgument = call.arguments[0];
    return callbackArgument && !isNodeOfType(callbackArgument, "SpreadElement")
      ? resolveLocalReactCallback(callbackArgument, scopes)
      : null;
  }
  const callback = resolveRecursiveAnimationFrameCallback(call, scopes);
  return callback && callbackRendersWithThree(callback, scopes) ? callback : null;
};
