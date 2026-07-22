import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { isNodeConditionallyExecuted } from "../../../utils/is-node-conditionally-executed.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import type { RuleVisitors } from "../../../utils/rule-visitors.js";
import {
  analyzeOwnedLifecycleCleanup,
  analyzeOwnedLifecycleResource,
  functionInvokesOwnedResourceMethod,
  ownedResourceHasMethodCall,
  type OwnedLifecycleResourceOptions,
} from "./analyze-owned-lifecycle-resource.js";
import { getApiReferenceProvenance } from "./get-api-reference-provenance.js";
import { isThreeModuleSource } from "./is-three-module-source.js";

export interface OwnedThreeResourceCleanupVisitorOptions {
  analysisOptions?: OwnedLifecycleResourceOptions;
  constructorNameSuffix: string;
  context: RuleContext;
  message: string;
}

export const createOwnedThreeResourceCleanupVisitors = ({
  analysisOptions,
  constructorNameSuffix,
  context,
  message,
}: OwnedThreeResourceCleanupVisitorOptions): RuleVisitors => ({
  NewExpression(node) {
    const provenance = getApiReferenceProvenance(node.callee, context.scopes);
    if (
      !provenance ||
      !isThreeModuleSource(provenance.moduleSource) ||
      !provenance.apiName.endsWith(constructorNameSuffix)
    ) {
      return;
    }
    const ownership = analyzeOwnedLifecycleResource(node, context, analysisOptions);
    if (!ownership || ownership.hasUnknownOwnershipTransfer) return;
    const allocationFunction = findEnclosingFunction(node);
    if (
      allocationFunction &&
      ownedResourceHasMethodCall(
        ownership,
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
    const cleanup = analyzeOwnedLifecycleCleanup(ownership, context, (cleanupFunction) =>
      functionInvokesOwnedResourceMethod(cleanupFunction, ownership, "dispose", context.scopes),
    );
    if (cleanup.isProven || cleanup.isUnknown) return;
    context.report({ node, message });
  },
});
