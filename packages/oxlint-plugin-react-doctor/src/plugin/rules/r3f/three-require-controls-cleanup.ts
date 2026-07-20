import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  analyzeOwnedLifecycleCleanup,
  analyzeOwnedLifecycleResource,
  analyzeOwnedLifecycleSetupCleanup,
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
const CONTROL_DISCONNECT_EQUIVALENT_CONSTRUCTORS = new Set([
  "DragControls",
  "FirstPersonControls",
  "FlyControls",
  "MapControls",
  "OrbitControls",
  "PointerLockControls",
  "TrackballControls",
]);

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
      const ownership = analyzeOwnedLifecycleResource(node, context, {
        borrowedArgumentMethodNames: CONTROL_BORROWING_METHOD_NAMES,
        retainsOwnershipInJsx: true,
      });
      if (!ownership || ownership.hasUnknownOwnershipTransfer) return;
      const cleanupMethodNames = CONTROL_DISCONNECT_EQUIVALENT_CONSTRUCTORS.has(provenance.apiName)
        ? ["disconnect", "dispose"]
        : ["dispose"];
      const cleanup = analyzeOwnedLifecycleCleanup(ownership, context, (cleanupFunction) =>
        cleanupMethodNames.some((methodName) =>
          functionInvokesOwnedResourceMethod(
            cleanupFunction,
            ownership,
            methodName,
            context.scopes,
          ),
        ),
      );
      if (cleanup.isProven || cleanup.isUnknown) return;
      if (CONTROL_DISCONNECT_EQUIVALENT_CONSTRUCTORS.has(provenance.apiName)) {
        const setupCleanup = analyzeOwnedLifecycleSetupCleanup(
          ownership,
          context,
          "connect",
          (cleanupFunction) =>
            cleanupMethodNames.some((methodName) =>
              functionInvokesOwnedResourceMethod(
                cleanupFunction,
                ownership,
                methodName,
                context.scopes,
              ),
            ),
        );
        if (setupCleanup.isProven || setupCleanup.isUnknown) return;
      }
      context.report({
        node,
        message:
          "These component-owned controls register DOM listeners but have no provable React cleanup. Dispose them when their owner changes or unmounts",
      });
    },
  }),
});
