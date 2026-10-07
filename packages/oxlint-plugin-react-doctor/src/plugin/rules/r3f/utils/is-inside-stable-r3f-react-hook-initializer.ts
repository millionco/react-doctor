import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isInsideStableReactInitializer } from "../../../utils/is-inside-stable-react-initializer.js";
import { isR3fReactApiCall } from "./is-r3f-react-api-call.js";

export const isInsideStableR3fReactHookInitializer = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean =>
  isInsideStableReactInitializer(node, scopes, {
    isReactHookCall: (hookCall, apiName) =>
      isR3fReactApiCall(hookCall, apiName, scopes, {
        allowGlobalReactNamespace: true,
      }),
  });
