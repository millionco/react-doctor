import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getApiReferenceProvenance } from "./get-api-reference-provenance.js";
import { isThreeModuleSource } from "./is-three-module-source.js";

const DYNAMIC_BUFFER_USAGE_NAMES: ReadonlySet<string> = new Set([
  "DynamicCopyUsage",
  "DynamicDrawUsage",
  "DynamicReadUsage",
  "StreamCopyUsage",
  "StreamDrawUsage",
  "StreamReadUsage",
]);

export const isDynamicBufferUsageExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const provenance = getApiReferenceProvenance(expression, scopes);
  return Boolean(
    provenance &&
    isThreeModuleSource(provenance.moduleSource) &&
    DYNAMIC_BUFFER_USAGE_NAMES.has(provenance.apiName),
  );
};
