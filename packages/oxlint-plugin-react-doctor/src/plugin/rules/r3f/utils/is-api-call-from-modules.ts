import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { getApiReferenceModuleSource } from "./get-api-reference-module-source.js";

export const isApiCallFromModules = (
  node: EsTreeNode,
  apiName: string,
  moduleSources: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const moduleSource = getApiReferenceModuleSource(node.callee, apiName, scopes);
  return moduleSource !== null && moduleSources.has(moduleSource);
};
