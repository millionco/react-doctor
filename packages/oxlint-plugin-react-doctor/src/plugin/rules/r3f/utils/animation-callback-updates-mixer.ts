import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isImportedOrStableParameterCall } from "../../../utils/is-imported-or-stable-parameter-call.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkFunctionExecution } from "./walk-function-execution.js";

export const animationCallbackUpdatesMixer = (
  callback: EsTreeNode,
  mixerKey: string,
  context: RuleContext,
): boolean => {
  let doesUpdateMixer = false;
  walkFunctionExecution(callback, context.scopes, (candidate) => {
    if (doesUpdateMixer || !isNodeOfType(candidate, "CallExpression")) return;
    if (
      isNodeOfType(candidate.callee, "MemberExpression") &&
      getStaticPropertyName(candidate.callee) === "update" &&
      resolveExpressionKey(candidate.callee.object, context) === mixerKey
    ) {
      doesUpdateMixer = true;
      return;
    }
    if (!isImportedOrStableParameterCall(candidate, context.scopes)) return;
    doesUpdateMixer = candidate.arguments.some(
      (argument) =>
        !isNodeOfType(argument, "SpreadElement") &&
        resolveExpressionKey(argument, context) === mixerKey,
    );
  });
  return doesUpdateMixer;
};
