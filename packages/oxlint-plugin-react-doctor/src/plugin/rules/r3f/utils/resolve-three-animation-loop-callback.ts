import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveRecursiveAnimationFrameCallback } from "../../../utils/resolve-recursive-animation-frame-callback.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { isThreeRendererReference } from "./is-three-renderer-reference.js";
import { resolveLocalReactCallback } from "./resolve-local-react-callback.js";
import { THREE_RENDER_METHOD_NAMES } from "./three-render-method-names.js";
import { walkFunctionExecution } from "./walk-function-execution.js";

const callbackRendersWithThree = (callback: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let doesRenderWithThree = false;
  walkFunctionExecution(callback, scopes, (candidate) => {
    if (doesRenderWithThree || !isNodeOfType(candidate, "CallExpression")) return;
    const callee = stripParenExpression(candidate.callee);
    if (
      isNodeOfType(callee, "MemberExpression") &&
      THREE_RENDER_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "") &&
      isThreeRendererReference(callee.object, scopes)
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
  const callee = stripParenExpression(call.callee);
  if (
    isNodeOfType(callee, "MemberExpression") &&
    getStaticPropertyName(callee) === "setAnimationLoop" &&
    isThreeRendererReference(callee.object, scopes)
  ) {
    const callbackArgument = call.arguments[0];
    return callbackArgument && !isNodeOfType(callbackArgument, "SpreadElement")
      ? resolveLocalReactCallback(callbackArgument, scopes)
      : null;
  }
  const callback = resolveRecursiveAnimationFrameCallback(call, scopes);
  return callback && callbackRendersWithThree(callback, scopes) ? callback : null;
};
