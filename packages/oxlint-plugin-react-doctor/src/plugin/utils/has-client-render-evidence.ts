import { componentOrHookDisplayNameForFunction } from "./component-or-hook-display-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactHookName } from "./is-react-hook-name.js";
import { walkAst } from "./walk-ast.js";
import type { EsTreeNode } from "./es-tree-node.js";

export const hasClientRenderEvidence = (
  componentOrHookNode: EsTreeNode,
  fileHasUseClientDirective: boolean,
): boolean => {
  if (fileHasUseClientDirective) return true;
  const displayName = componentOrHookDisplayNameForFunction(componentOrHookNode);
  if (displayName && isReactHookName(displayName)) return true;
  let callsHook = false;
  const componentBody = isFunctionLike(componentOrHookNode) ? componentOrHookNode.body : null;
  walkAst(componentBody ?? componentOrHookNode, (child: EsTreeNode) => {
    if (callsHook) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      isReactHookName(child.callee.name)
    ) {
      callsHook = true;
      return false;
    }
  });
  return callsHook;
};
