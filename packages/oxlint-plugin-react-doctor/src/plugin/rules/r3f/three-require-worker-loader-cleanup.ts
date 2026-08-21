import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  analyzeOwnedLifecycleCleanup,
  analyzeOwnedLifecycleResource,
  functionInvokesOwnedResourceMethod,
} from "./utils/analyze-owned-lifecycle-resource.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";

const WORKER_LOADER_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set(["DRACOLoader", "KTX2Loader"]);
const WORKER_LOADER_BORROWING_METHOD_NAMES: ReadonlySet<string> = new Set([
  "setDRACOLoader",
  "setKTX2Loader",
]);

const isWorkerLoaderModuleSource = (moduleSource: string): boolean =>
  moduleSource.startsWith("three/addons/loaders/") ||
  moduleSource.startsWith("three/examples/jsm/loaders/") ||
  moduleSource === "three-stdlib";

export const threeRequireWorkerLoaderCleanup = defineRule({
  id: "three-require-worker-loader-cleanup",
  title: "Undisposed Three.js worker-backed loader",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Dispose component-owned DRACO and KTX2 loaders so decoder workers and internal resources are released",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      if (
        !provenance ||
        !WORKER_LOADER_CONSTRUCTOR_NAMES.has(provenance.apiName) ||
        !isWorkerLoaderModuleSource(provenance.moduleSource)
      ) {
        return;
      }
      const ownership = analyzeOwnedLifecycleResource(node, context, {
        borrowedArgumentMethodNames: WORKER_LOADER_BORROWING_METHOD_NAMES,
      });
      if (!ownership || ownership.hasUnknownOwnershipTransfer) return;
      const cleanup = analyzeOwnedLifecycleCleanup(ownership, context, (cleanupFunction) =>
        functionInvokesOwnedResourceMethod(cleanupFunction, ownership, "dispose", context.scopes),
      );
      if (cleanup.isProven || cleanup.isUnknown) return;
      context.report({
        node,
        message: `This component-owned ${provenance.apiName} has no provable dispose cleanup, so decoder workers or transcoder resources can survive dependency changes or unmount`,
      });
    },
  }),
});
