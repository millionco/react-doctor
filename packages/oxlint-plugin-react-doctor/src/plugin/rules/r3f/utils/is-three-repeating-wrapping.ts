import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { getApiReferenceProvenance } from "./get-api-reference-provenance.js";
import { isThreeModuleSource } from "./is-three-module-source.js";

const THREE_REPEATING_WRAPPING_NAMES: ReadonlySet<string> = new Set([
  "MirroredRepeatWrapping",
  "RepeatWrapping",
]);

export const isThreeRepeatingWrapping = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const provenance = getApiReferenceProvenance(expression, scopes);
  return Boolean(
    provenance &&
    THREE_REPEATING_WRAPPING_NAMES.has(provenance.apiName) &&
    isThreeModuleSource(provenance.moduleSource),
  );
};
