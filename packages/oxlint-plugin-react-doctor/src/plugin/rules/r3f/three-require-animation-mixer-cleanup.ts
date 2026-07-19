import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getNodeStartIndex } from "../../utils/get-node-start-index.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  analyzeOwnedLifecycleCleanup,
  analyzeOwnedLifecycleResource,
  expressionMatchesOwnedLifecycleResource,
  ownedResourceHasMethodCall,
  type OwnedLifecycleResourceAnalysis,
} from "./utils/analyze-owned-lifecycle-resource.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const MIXER_BORROWING_METHOD_NAMES = new Set<string>();
const FINE_GRAINED_UNCACHE_METHOD_NAMES = ["uncacheAction", "uncacheClip"];

const hasUnsupportedClipActionRoot = (
  analysis: OwnedLifecycleResourceAnalysis,
  rootKey: string,
  context: RuleContext,
): boolean =>
  ownedResourceHasMethodCall(analysis, "clipAction", context.scopes, (call) => {
    const optionalRoot = call.arguments[1];
    if (!optionalRoot) return false;
    if (isNodeOfType(optionalRoot, "SpreadElement")) return true;
    return resolveExpressionKey(optionalRoot, context) !== rootKey;
  });

const hasOrderedMixerCleanup = (
  cleanupFunction: EsTreeNode,
  analysis: OwnedLifecycleResourceAnalysis,
  rootKey: string,
  context: RuleContext,
): boolean => {
  const stopCalls: EsTreeNodeOfType<"CallExpression">[] = [];
  const uncacheCalls: EsTreeNodeOfType<"CallExpression">[] = [];
  walkFunctionExecution(cleanupFunction, context.scopes, (candidate, isConditionallyExecuted) => {
    if (
      isConditionallyExecuted ||
      !isNodeOfType(candidate, "CallExpression") ||
      !isNodeOfType(candidate.callee, "MemberExpression") ||
      !expressionMatchesOwnedLifecycleResource(candidate.callee.object, analysis, context.scopes)
    ) {
      return;
    }
    const methodName = getStaticPropertyName(candidate.callee);
    if (methodName === "stopAllAction") {
      stopCalls.push(candidate);
      return;
    }
    const rootArgument = candidate.arguments[0];
    if (
      methodName === "uncacheRoot" &&
      rootArgument &&
      !isNodeOfType(rootArgument, "SpreadElement") &&
      resolveExpressionKey(rootArgument, context) === rootKey
    ) {
      uncacheCalls.push(candidate);
    }
  });
  return stopCalls.some((stopCall) =>
    uncacheCalls.some((uncacheCall) => {
      const stopOwner = findEnclosingFunction(stopCall);
      const uncacheOwner = findEnclosingFunction(uncacheCall);
      if (!stopOwner || !uncacheOwner || stopOwner !== uncacheOwner) return false;
      const stopIndex = getNodeStartIndex(stopCall);
      const uncacheIndex = getNodeStartIndex(uncacheCall);
      return stopIndex < 0 || uncacheIndex < 0 || stopIndex < uncacheIndex;
    }),
  );
};

export const threeRequireAnimationMixerCleanup = defineRule({
  id: "three-require-animation-mixer-cleanup",
  title: "Unreleased Three.js animation mixer actions",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Stop component-owned AnimationMixer actions and uncache their owned root in React cleanup",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      const rootArgument = node.arguments[0];
      if (
        provenance?.moduleSource !== "three" ||
        provenance.apiName !== "AnimationMixer" ||
        !rootArgument ||
        isNodeOfType(rootArgument, "SpreadElement")
      ) {
        return;
      }
      const rootKey = resolveExpressionKey(rootArgument, context);
      if (!rootKey) return;
      const analysis = analyzeOwnedLifecycleResource(node, context, {
        borrowedArgumentMethodNames: MIXER_BORROWING_METHOD_NAMES,
      });
      if (!analysis || analysis.hasUnknownOwnershipTransfer) return;
      const hasClipAction = ownedResourceHasMethodCall(analysis, "clipAction", context.scopes);
      if (!hasClipAction || hasUnsupportedClipActionRoot(analysis, rootKey, context)) return;
      if (
        FINE_GRAINED_UNCACHE_METHOD_NAMES.some((methodName) =>
          ownedResourceHasMethodCall(analysis, methodName, context.scopes),
        )
      ) {
        return;
      }
      const cleanup = analyzeOwnedLifecycleCleanup(analysis, context, (cleanupFunction) =>
        hasOrderedMixerCleanup(cleanupFunction, analysis, rootKey, context),
      );
      if (cleanup.isProven || cleanup.isUnknown) return;
      context.report({
        node,
        message:
          "This component-owned AnimationMixer caches actions but has no cleanup that stops all actions before uncaching its owned root",
      });
    },
  }),
});
