import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { JSX_DESCENDANT_SCAN_NODE_BUDGET } from "../constants/thresholds.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findProgramRoot } from "./find-program-root.js";
import { getClosedIntrinsicJsxMapCallback } from "./get-closed-intrinsic-jsx-map-callback.js";
import { getClosedIntrinsicJsxTreeProof } from "./get-closed-intrinsic-jsx-tree-proof.js";
import { hasCompleteGlobalReferences } from "./has-complete-global-references.js";
import { hasGlobalNamespaceMutation } from "./has-global-namespace-mutation.js";
import { hasOpaqueIntrinsicAccess } from "./has-opaque-intrinsic-access.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isUnconditionalComponentRenderResult } from "./is-unconditional-component-render-result.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const ARRAY_CAPABILITY_GLOBAL_NAMES = new Set(["Array"]);

export const isFixedIntrinsicJsxMap = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(call.callee, "MemberExpression") || call.callee.computed) return false;
  if (!isNodeOfType(call.callee.property, "Identifier") || call.callee.property.name !== "map")
    return false;
  const receiver = stripParenExpression(call.callee.object);
  if (!isNodeOfType(receiver, "ArrayExpression") || receiver.elements.length === 0) return false;
  if (call.arguments.length !== 1) return false;
  const program = findProgramRoot(call);
  if (
    !program ||
    !hasCompleteGlobalReferences(ARRAY_CAPABILITY_GLOBAL_NAMES, program, scopes) ||
    hasOpaqueIntrinsicAccess(program, scopes, {
      protectedGlobalNames: ARRAY_CAPABILITY_GLOBAL_NAMES,
    }) ||
    hasGlobalNamespaceMutation("Array", scopes, undefined, true) ||
    !isUnconditionalComponentRenderResult(call, scopes)
  )
    return false;
  const budget = { remainingNodes: JSX_DESCENDANT_SCAN_NODE_BUDGET };
  if (
    receiver.elements.length > budget.remainingNodes ||
    !receiver.elements.every(
      (element) => element && getClosedIntrinsicJsxTreeProof(element, budget),
    )
  )
    return false;
  if (!getClosedIntrinsicJsxMapCallback(call.arguments[0], budget)) return false;
  return true;
};
