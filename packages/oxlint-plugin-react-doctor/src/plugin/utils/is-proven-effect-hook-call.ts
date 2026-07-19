import { EFFECT_HOOK_NAMES } from "../constants/react.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";

export const isProvenReactHookCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  hookNames: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean =>
  isReactApiCall(call, hookNames, scopes, {
    allowGlobalReactNamespace: true,
    allowUnboundBareCalls: true,
    resolveNamedAliases: true,
  });

export const isProvenEffectHookCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => isProvenReactHookCall(call, EFFECT_HOOK_NAMES, scopes);
