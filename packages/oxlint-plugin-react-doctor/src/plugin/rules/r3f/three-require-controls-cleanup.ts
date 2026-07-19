import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  analyzeOwnedLifecycleCleanup,
  analyzeOwnedLifecycleResource,
  functionInvokesOwnedResourceMethod,
} from "./utils/analyze-owned-lifecycle-resource.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";

const CONTROL_CONSTRUCTORS = new Set([
  "ArcballControls",
  "DragControls",
  "FirstPersonControls",
  "FlyControls",
  "MapControls",
  "OrbitControls",
  "PointerLockControls",
  "TrackballControls",
  "TransformControls",
]);
const CONTROL_BORROWING_METHOD_NAMES = new Set<string>();

const isControlsModuleSource = (moduleSource: string): boolean =>
  moduleSource === "three-stdlib" ||
  moduleSource.startsWith("three/addons/controls/") ||
  moduleSource.startsWith("three/examples/jsm/controls/");

export const threeRequireControlsCleanup = defineRule({
  id: "three-require-controls-cleanup",
  title: "Undisposed imperative Three.js controls",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Dispose component-owned Three.js controls in a React cleanup so their DOM listeners are removed",
  requires: ["r3f:3"],
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      if (
        !provenance ||
        !CONTROL_CONSTRUCTORS.has(provenance.apiName) ||
        !isControlsModuleSource(provenance.moduleSource)
      ) {
        return;
      }
      const ownership = analyzeOwnedLifecycleResource(
        node,
        context,
        CONTROL_BORROWING_METHOD_NAMES,
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
          "These component-owned controls register DOM listeners but have no provable React cleanup. Dispose them when their owner changes or unmounts",
      });
    },
  }),
});
