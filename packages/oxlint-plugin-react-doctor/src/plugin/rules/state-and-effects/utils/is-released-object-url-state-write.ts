import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { nodeDominatesNode } from "../../../utils/node-dominates-node.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkAst } from "../../../utils/walk-ast.js";

export const isReleasedObjectUrlStateWrite = (write: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(write, "CallExpression")) return false;
  const value = write.arguments[0];
  if (!isNodeOfType(value, "Literal") || value.value !== null) return false;
  const pair = resolveReactUseStatePair(write.callee, context.scopes);
  const owner = findEnclosingFunction(write);
  if (!pair?.stateSymbol || !owner) return false;
  let didRelease = false;
  walkAst(owner, (node) => {
    if (didRelease || (node !== owner && isFunctionLike(node))) return false;
    if (
      !isNodeOfType(node, "CallExpression") ||
      !isNodeOfType(node.callee, "MemberExpression") ||
      getStaticPropertyName(node.callee) !== "revokeObjectURL" ||
      !isNodeOfType(node.callee.object, "Identifier") ||
      node.callee.object.name !== "URL" ||
      !context.scopes.isGlobalReference(node.callee.object)
    )
      return;
    const handle = node.arguments[0];
    if (
      isNodeOfType(handle, "Identifier") &&
      context.scopes.symbolFor(handle) === pair.stateSymbol &&
      nodeDominatesNode(node, write, context)
    )
      didRelease = true;
  });
  return didRelease;
};
