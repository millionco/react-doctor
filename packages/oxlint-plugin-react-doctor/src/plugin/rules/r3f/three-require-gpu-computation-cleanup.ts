import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  analyzeOwnedLifecycleCleanup,
  analyzeOwnedLifecycleResource,
  functionInvokesOwnedResourceMethod,
} from "./utils/analyze-owned-lifecycle-resource.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";

const GPU_COMPUTATION_BORROWING_METHOD_NAMES: ReadonlySet<string> = new Set();

const isGpuComputationModule = (moduleSource: string): boolean =>
  moduleSource === "three-stdlib" ||
  moduleSource === "three/addons/misc/GPUComputationRenderer.js" ||
  moduleSource === "three/examples/jsm/misc/GPUComputationRenderer.js";

export const threeRequireGpuComputationCleanup = defineRule({
  id: "three-require-gpu-computation-cleanup",
  title: "Undisposed Three.js GPU computation renderer",
  category: "Correctness",
  severity: "warn",
  recommendation: "Dispose component-owned GPUComputationRenderer instances during effect cleanup",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      if (
        provenance?.apiName !== "GPUComputationRenderer" ||
        !isGpuComputationModule(provenance.moduleSource)
      ) {
        return;
      }
      const ownership = analyzeOwnedLifecycleResource(node, context, {
        borrowedArgumentMethodNames: GPU_COMPUTATION_BORROWING_METHOD_NAMES,
      });
      if (!ownership || ownership.hasUnknownOwnershipTransfer) return;
      const cleanup = analyzeOwnedLifecycleCleanup(ownership, context, (cleanupFunction) =>
        functionInvokesOwnedResourceMethod(cleanupFunction, ownership, "dispose", context.scopes),
      );
      if (cleanup.isProven || cleanup.isUnknown) return;
      context.report({
        node,
        message:
          "This component-owned GPUComputationRenderer has no provable dispose cleanup, so its ping-pong targets, textures, and materials can survive dependency changes or unmount",
      });
    },
  }),
});
