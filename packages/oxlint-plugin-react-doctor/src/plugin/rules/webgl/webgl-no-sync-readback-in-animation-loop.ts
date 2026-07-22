import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isCpuTypedArray } from "../../utils/is-cpu-typed-array.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isWebglContextReference } from "../../utils/is-webgl-context-reference.js";
import { resolveRecursiveAnimationFrameCallback } from "../../utils/resolve-recursive-animation-frame-callback.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isThreeRendererReference } from "../r3f/utils/is-three-renderer-reference.js";
import { resolveThreeAnimationLoopCallback } from "../r3f/utils/resolve-three-animation-loop-callback.js";
import { walkFunctionExecution } from "../r3f/utils/walk-function-execution.js";
import {
  WEBGL_GET_BUFFER_SUB_DATA_DESTINATION_ARGUMENT_INDEX,
  WEBGL_READ_PIXELS_DESTINATION_ARGUMENT_INDEX,
} from "./constants.js";

const getBlockingReadbackKind = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): "finish" | "raw" | "three" | null => {
  if (!isNodeOfType(call.callee, "MemberExpression")) return null;
  const methodName = getStaticPropertyName(call.callee);
  if (
    methodName === "readRenderTargetPixels" &&
    isThreeRendererReference(call.callee.object, context.scopes)
  ) {
    return "three";
  }
  if (!isWebglContextReference(call.callee.object, context.scopes)) return null;
  if (methodName === "finish") return "finish";
  let destinationArgumentIndex: number | null = null;
  if (methodName === "readPixels") {
    destinationArgumentIndex = WEBGL_READ_PIXELS_DESTINATION_ARGUMENT_INDEX;
  } else if (methodName === "getBufferSubData") {
    destinationArgumentIndex = WEBGL_GET_BUFFER_SUB_DATA_DESTINATION_ARGUMENT_INDEX;
  }
  if (destinationArgumentIndex === null) return null;
  const destination = call.arguments[destinationArgumentIndex];
  return destination &&
    !isNodeOfType(destination, "SpreadElement") &&
    isCpuTypedArray(destination, context.scopes)
    ? "raw"
    : null;
};

export const webglNoSyncReadbackInAnimationLoop = defineRule({
  id: "webgl-no-sync-readback-in-animation-loop",
  title: "Synchronous GPU readback inside animation loop",
  severity: "warn",
  recommendation:
    "Move GPU readback to a discrete or asynchronous path and reuse the latest completed result during frames",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback =
          resolveThreeAnimationLoopCallback(node, context.scopes) ??
          resolveRecursiveAnimationFrameCallback(node, context.scopes);
        if (!callback || analyzedCallbacks.has(callback)) return;
        analyzedCallbacks.add(callback);
        walkFunctionExecution(callback, context.scopes, (candidate, isConditionallyExecuted) => {
          if (!isNodeOfType(candidate, "CallExpression") || isConditionallyExecuted) return;
          const readbackKind = getBlockingReadbackKind(candidate, context);
          if (!readbackKind) return;
          context.report({
            node: candidate,
            message:
              readbackKind === "finish"
                ? "finish blocks the calling thread until queued GPU work completes. Synchronize outside the animation loop"
                : "Synchronous GPU readback can stall the frame until prior GPU work completes. Use an asynchronous or event-driven readback path",
          });
        });
      },
    };
  },
});
