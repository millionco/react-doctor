import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isApiCallFromModules } from "./utils/is-api-call-from-modules.js";
import { isR3fCallbackStateProperty } from "./utils/is-r3f-callback-state-property.js";
import { R3F_WEBGPU_MODULES } from "./utils/r3f-webgpu-modules.js";
import { resolveLocalReactCallback } from "./utils/resolve-local-react-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const WEBGPU_PIPELINE_HOOKS: ReadonlySet<string> = new Set([
  "usePostProcessing",
  "useRenderPipeline",
]);

const findDirectPassRegistryWrite = (callback: EsTreeNode, context: RuleContext): EsTreeNode[] => {
  const writes: EsTreeNode[] = [];
  walkFunctionExecution(callback, context.scopes, (candidate) => {
    if (
      !isNodeOfType(candidate, "AssignmentExpression") ||
      !isNodeOfType(candidate.left, "MemberExpression") ||
      !isR3fCallbackStateProperty(candidate.left.object, callback, "passes", context.scopes)
    ) {
      return;
    }
    writes.push(candidate.left);
  });
  return writes;
};

export const r3fWebgpuNoUnregisteredPipelinePass = defineRule({
  id: "r3f-webgpu-no-unregistered-pipeline-pass",
  title: "Unregistered WebGPU pipeline pass",
  category: "Correctness",
  requires: ["r3f:10"],
  severity: "error",
  recommendation:
    "Return custom passes from the WebGPU post-processing callback so R3F registers them in state.passes",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      let isPipelineHookCall = false;
      for (const hookName of WEBGPU_PIPELINE_HOOKS) {
        if (isApiCallFromModules(node, hookName, R3F_WEBGPU_MODULES, context.scopes)) {
          isPipelineHookCall = true;
          break;
        }
      }
      if (!isPipelineHookCall) return;
      for (const callbackArgument of node.arguments.slice(0, 2)) {
        if (!callbackArgument || isNodeOfType(callbackArgument, "SpreadElement")) continue;
        const callback = resolveLocalReactCallback(callbackArgument, context.scopes);
        if (!isFunctionLike(callback)) continue;
        for (const write of findDirectPassRegistryWrite(callback, context)) {
          context.report({
            node: write,
            message:
              "Direct assignment does not register this WebGPU pipeline pass and is discarded after the callback. Return the pass in an object instead",
          });
        }
      }
    },
  }),
});
