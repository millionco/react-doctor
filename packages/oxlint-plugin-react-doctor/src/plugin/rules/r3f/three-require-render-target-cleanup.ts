import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import {
  analyzeOwnedLifecycleCleanup,
  analyzeOwnedLifecycleResource,
  functionInvokesOwnedResourceMethod,
  ownedResourceHasMethodCall,
} from "./utils/analyze-owned-lifecycle-resource.js";

const RENDER_TARGET_CONSTRUCTORS = new Set([
  "RenderTarget",
  "WebGLCubeRenderTarget",
  "WebGLRenderTarget",
]);
const RENDER_TARGET_BORROWING_METHODS = new Set([
  "readRenderTargetPixels",
  "readRenderTargetPixelsAsync",
  "setRenderTarget",
  "setRenderTargetTextures",
]);

const isThreeModuleSource = (moduleSource: string): boolean =>
  moduleSource === "three" || moduleSource === "three-stdlib" || moduleSource.startsWith("three/");

export const threeRequireRenderTargetCleanup = defineRule({
  id: "three-require-render-target-cleanup",
  title: "Undisposed Three.js render target",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Dispose component-owned render targets in a React cleanup that follows the render target binding",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      if (
        !provenance ||
        !RENDER_TARGET_CONSTRUCTORS.has(provenance.apiName) ||
        !isThreeModuleSource(provenance.moduleSource)
      ) {
        return;
      }
      const analysis = analyzeOwnedLifecycleResource(node, context, {
        borrowedArgumentMethodNames: RENDER_TARGET_BORROWING_METHODS,
      });
      if (!analysis || analysis.hasUnknownOwnershipTransfer) return;
      const allocationFunction = findEnclosingFunction(node);
      if (
        allocationFunction &&
        ownedResourceHasMethodCall(
          analysis,
          "dispose",
          context.scopes,
          (call) =>
            call.range[0] > node.range[1] &&
            findEnclosingFunction(call) === allocationFunction &&
            !isNodeConditionallyExecuted(call, allocationFunction),
        )
      ) {
        return;
      }
      const cleanup = analyzeOwnedLifecycleCleanup(analysis, context, (cleanupFunction) =>
        functionInvokesOwnedResourceMethod(cleanupFunction, analysis, "dispose", context.scopes),
      );
      if (cleanup.isProven || cleanup.isUnknown) return;
      context.report({
        node,
        message:
          "This component-owned render target is not disposed by a matching React cleanup, so its GPU framebuffer and textures can survive dependency changes or unmount",
      });
    },
  }),
});
