import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isApiCallFromModules } from "./is-api-call-from-modules.js";
import { R3F_PUBLIC_MODULES } from "./r3f-public-modules.js";

export const isR3fApiCall = (node: EsTreeNode, apiName: string, scopes: ScopeAnalysis): boolean =>
  isApiCallFromModules(node, apiName, R3F_PUBLIC_MODULES, scopes);
