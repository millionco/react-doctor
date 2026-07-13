import { BUILTIN_HOOK_NAMES } from "../constants/react.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { walkAst } from "./walk-ast.js";

export const functionContainsProvenReactHookCall = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isFunctionLike(functionNode)) return false;
  let containsReactHookCall = false;
  walkAst(functionNode.body, (node) => {
    if (containsReactHookCall) return false;
    if (
      node !== functionNode.body &&
      (isFunctionLike(node) ||
        isNodeOfType(node, "ClassDeclaration") ||
        isNodeOfType(node, "ClassExpression"))
    ) {
      return false;
    }
    if (
      isNodeOfType(node, "CallExpression") &&
      isReactApiCall(node, BUILTIN_HOOK_NAMES, scopes, { resolveNamedAliases: true })
    ) {
      containsReactHookCall = true;
      return false;
    }
  });
  return containsReactHookCall;
};
