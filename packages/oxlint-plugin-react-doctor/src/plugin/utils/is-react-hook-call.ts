import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isReactApiCall, type ReactApiCallOptions } from "./is-react-api-call.js";

const REACT_HOOK_CALL_OPTIONS: ReactApiCallOptions = {
  allowGlobalReactNamespace: true,
  allowUnboundBareCalls: true,
  resolveConditionalAliases: true,
  resolveNamedAliases: true,
};

export const isReactHookCall = (
  node: EsTreeNode,
  hookNames: string | ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => isReactApiCall(node, hookNames, scopes, REACT_HOOK_CALL_OPTIONS);
