import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { hasCompleteGlobalReferences } from "../../../utils/has-complete-global-references.js";
import { hasGlobalNamespaceMutation } from "../../../utils/has-global-namespace-mutation.js";
import { hasOpaqueIntrinsicAccess } from "../../../utils/has-opaque-intrinsic-access.js";
import {
  CLOSED_CLASS_MERGER_CAPABILITY_NAMES,
  CLOSED_CLASS_MERGER_INTRINSIC_NAMES,
} from "./closed-class-merger/constants.js";

export const hasClosedMergerIntrinsics = (program: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  hasCompleteGlobalReferences(CLOSED_CLASS_MERGER_CAPABILITY_NAMES, program, scopes) &&
  !hasOpaqueIntrinsicAccess(program, scopes, {
    protectedGlobalNames: CLOSED_CLASS_MERGER_CAPABILITY_NAMES,
  }) &&
  [...CLOSED_CLASS_MERGER_INTRINSIC_NAMES].every(
    (name) => !hasGlobalNamespaceMutation(name, scopes, undefined, true),
  );
