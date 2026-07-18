import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isReactApiCall } from "./is-react-api-call.js";

export const isReactHookCall = (
  node: EsTreeNode,
  hookNames: string | ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean =>
  isReactApiCall(node, hookNames, scopes, {
    allowGlobalReactNamespace: true,
    allowUnboundBareCalls: true,
    resolveConditionalAliases: true,
    resolveNamedAliases: true,
  });
