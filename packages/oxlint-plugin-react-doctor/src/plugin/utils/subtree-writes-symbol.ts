import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";
import { walkAst } from "./walk-ast.js";

export const subtreeWritesSymbol = (
  node: EsTreeNode,
  symbolIds: ReadonlySet<number>,
  context: RuleContext,
  isAllowedAssignment?: (assignment: EsTreeNodeOfType<"AssignmentExpression">) => boolean,
  beforeNode?: EsTreeNode,
): boolean => {
  let didWriteSymbol = false;
  walkAst(node, (child) => {
    if (didWriteSymbol) return false;
    if (beforeNode && child.range[0] >= beforeNode.range[0]) return false;
    if (child !== node && isFunctionLike(child)) return false;
    let target: EsTreeNode | null = null;
    if (isNodeOfType(child, "AssignmentExpression")) {
      if (isAllowedAssignment?.(child)) return false;
      target = child.left as EsTreeNode;
    } else if (isNodeOfType(child, "UpdateExpression")) {
      target = child.argument as EsTreeNode;
    } else if (isNodeOfType(child, "UnaryExpression") && child.operator === "delete") {
      target = child.argument as EsTreeNode;
    }
    if (!target) return;
    const targetRoot = getRootIdentifier(target);
    const targetSymbol = targetRoot ? context.scopes.symbolFor(targetRoot) : null;
    if (targetSymbol && symbolIds.has(targetSymbol.id)) {
      didWriteSymbol = true;
      return false;
    }
  });
  return didWriteSymbol;
};
