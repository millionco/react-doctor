import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isFunctionLike } from "./is-function-like.js";
import { isGlobalBrowserFunctionCall } from "./is-global-browser-function-call.js";
import { isNodeOnUnconditionalPath } from "./is-node-on-unconditional-path.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { walkAst } from "./walk-ast.js";

interface ResolveRecursiveAnimationFrameCallbackOptions {
  readonly requireUnconditionalSchedule?: boolean;
}

const getAnimationFrameCallback = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const callbackArgument = call.arguments[0];
  return callbackArgument && !isNodeOfType(callbackArgument, "SpreadElement")
    ? resolveExactLocalFunction(callbackArgument, scopes)
    : null;
};

const callbackSchedulesItself = (
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
  shouldRequireUnconditionalSchedule: boolean,
): boolean => {
  let doesScheduleItself = false;
  walkAst(callback, (candidate) => {
    if (doesScheduleItself || (candidate !== callback && isFunctionLike(candidate))) return false;
    if (
      isNodeOfType(candidate, "CallExpression") &&
      isGlobalBrowserFunctionCall(candidate, "requestAnimationFrame", scopes) &&
      getAnimationFrameCallback(candidate, scopes) === callback &&
      (!shouldRequireUnconditionalSchedule || isNodeOnUnconditionalPath(candidate, callback))
    ) {
      doesScheduleItself = true;
      return false;
    }
  });
  return doesScheduleItself;
};

export const resolveRecursiveAnimationFrameCallback = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
  options: ResolveRecursiveAnimationFrameCallbackOptions = {},
): EsTreeNode | null => {
  if (!isGlobalBrowserFunctionCall(call, "requestAnimationFrame", scopes)) return null;
  const callback = getAnimationFrameCallback(call, scopes);
  return callback &&
    callbackSchedulesItself(callback, scopes, options.requireUnconditionalSchedule === true)
    ? callback
    : null;
};
