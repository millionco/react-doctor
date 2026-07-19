import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  analyzeOwnedLifecycleCleanup,
  analyzeOwnedLifecycleResource,
  functionInvokesOwnedResourceMethod,
} from "./utils/analyze-owned-lifecycle-resource.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";

const OWNED_TEXTURE_CONSTRUCTOR_NAMES = new Set(["CanvasTexture", "DataTexture", "VideoTexture"]);
const TEXTURE_BORROWING_METHOD_NAMES = new Set<string>();

export const r3fRequireOwnedTextureCleanup = defineRule({
  id: "r3f-require-owned-texture-cleanup",
  title: "Locally owned Three.js texture is not disposed",
  category: "Performance",
  severity: "warn",
  recommendation: "Dispose locally constructed textures in a React effect cleanup",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      if (
        provenance?.moduleSource !== "three" ||
        !OWNED_TEXTURE_CONSTRUCTOR_NAMES.has(provenance.apiName)
      ) {
        return;
      }
      const ownership = analyzeOwnedLifecycleResource(
        node,
        context,
        TEXTURE_BORROWING_METHOD_NAMES,
        true,
      );
      if (!ownership || ownership.hasUnknownOwnershipTransfer) return;
      const cleanup = analyzeOwnedLifecycleCleanup(ownership, context, (cleanupFunction) =>
        functionInvokesOwnedResourceMethod(cleanupFunction, ownership, "dispose", context.scopes),
      );
      if (cleanup.isProven || cleanup.isUnknown) return;
      context.report({
        node,
        message:
          "This locally constructed Three.js texture owns GPU resources but has no provable React cleanup. Dispose it when the owning component or hook releases it",
      });
    },
  }),
});
