import type { Reference } from "eslint-scope";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EffectStateWriteFact } from "./collect-effect-state-write-facts.js";
import { getUpstreamRefs } from "./effect/ast.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import { getEffectDepsRefs, isState } from "./effect/react.js";

const referencesSameBinding = (leftReference: Reference, rightReference: Reference): boolean =>
  leftReference.resolved
    ? leftReference.resolved === rightReference.resolved
    : leftReference.identifier.name === rightReference.identifier.name;

export const isRenderKnownSelectionRepair = (
  analysis: ProgramAnalysis,
  effectNode: EsTreeNode,
  fact: EffectStateWriteFact,
): boolean => {
  const indexedMemberRootReference = fact.writtenIndexedMemberRootReference;
  if (
    !fact.hasIndependentWriter ||
    !fact.readsWrittenState ||
    fact.isDeferred ||
    fact.resetsSourceState ||
    !indexedMemberRootReference
  ) {
    return false;
  }
  const dependencyReferences = getEffectDepsRefs(analysis, effectNode);
  if (!dependencyReferences) return false;
  return (
    getUpstreamRefs(analysis, indexedMemberRootReference).some((upstreamReference) =>
      isState(analysis, upstreamReference),
    ) &&
    dependencyReferences.some((dependencyReference) =>
      referencesSameBinding(dependencyReference, indexedMemberRootReference),
    )
  );
};
