import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveRecursiveAnimationFrameCallback } from "../../../utils/resolve-recursive-animation-frame-callback.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { isThreeRendererReference } from "./is-three-renderer-reference.js";
import { resolveLocalReactCallback } from "./resolve-local-react-callback.js";
import { callbackRendersWithThree } from "./callback-renders-with-three.js";

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
