import { REACT_RUNTIME_MODULE_SOURCES } from "../../../constants/react.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isReactApiCall, type ReactApiCallOptions } from "../../../utils/is-react-api-call.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { getApiReferenceProvenance } from "./get-api-reference-provenance.js";

const includesApiName = (apiNames: string | ReadonlySet<string>, apiName: string): boolean =>
  typeof apiNames === "string" ? apiNames === apiName : apiNames.has(apiName);

export const isR3fReactApiCall = (
  node: EsTreeNode,
  apiNames: string | ReadonlySet<string>,
  scopes: ScopeAnalysis,
  options: ReactApiCallOptions = {},
): boolean => {
  if (isReactApiCall(node, apiNames, scopes, options)) return true;
  if (!isNodeOfType(node, "CallExpression")) return false;
  const provenance = getApiReferenceProvenance(node.callee, scopes);
  return Boolean(
    provenance &&
    REACT_RUNTIME_MODULE_SOURCES.has(provenance.moduleSource) &&
    includesApiName(apiNames, provenance.apiName),
  );
};
