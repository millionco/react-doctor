import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  analyzeOwnedLifecycleCleanup,
  analyzeOwnedLifecycleResource,
  functionInvokesOwnedResourceMethod,
} from "./utils/analyze-owned-lifecycle-resource.js";
import { getApiReferenceModuleSource } from "./utils/get-api-reference-module-source.js";
import { R3F_PUBLIC_MODULES } from "./utils/r3f-public-modules.js";

export const r3fRequireRootUnmount = defineRule({
  id: "r3f-require-root-unmount",
  title: "R3F root without unmount cleanup",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Unmount component-owned R3F roots in React cleanup, or return an exact disposer that unmounts the root",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const moduleSource = getApiReferenceModuleSource(node.callee, "createRoot", context.scopes);
      if (!moduleSource || !R3F_PUBLIC_MODULES.has(moduleSource)) return;
      const analysis = analyzeOwnedLifecycleResource(node, context);
      if (!analysis || analysis.hasUnknownOwnershipTransfer) return;
      const cleanup = analyzeOwnedLifecycleCleanup(analysis, context, (cleanupFunction) =>
        functionInvokesOwnedResourceMethod(cleanupFunction, analysis, "unmount", context.scopes),
      );
      if (cleanup.isProven || cleanup.isUnknown) return;
      context.report({
        node,
        message:
          "This component-owned R3F root is never unmounted. Return cleanup that calls root.unmount() so the reconciler, events, and renderer are released",
      });
    },
  }),
});
