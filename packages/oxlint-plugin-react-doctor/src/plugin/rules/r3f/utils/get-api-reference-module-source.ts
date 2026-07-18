import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getApiReferenceProvenance } from "./get-api-reference-provenance.js";

export const getApiReferenceModuleSource = (
  reference: EsTreeNode,
  apiName: string,
  scopes: ScopeAnalysis,
): string | null => {
  const provenance = getApiReferenceProvenance(reference, scopes);
  return provenance?.apiName === apiName ? provenance.moduleSource : null;
};
