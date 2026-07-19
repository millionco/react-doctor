import { EFFECT_HOOK_NAMES } from "../constants/react.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isReactApiCall } from "./is-react-api-call.js";

export const isReactEffectHookCall = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isReactApiCall(node, EFFECT_HOOK_NAMES, scopes, {
    allowGlobalReactNamespace: true,
    allowUnboundBareCalls: true,
    resolveConditionalAliases: true,
    resolveNamedAliases: true,
  });
