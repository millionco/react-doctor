import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import type { BasicBlock } from "../../semantic/control-flow-graph.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveInkApiName } from "../../utils/resolve-ink-api-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const canReachBlock = (sourceBlock: BasicBlock, targetBlock: BasicBlock): boolean => {
  if (sourceBlock === targetBlock) return true;
  const visitedBlocks = new Set([sourceBlock]);
  const pendingBlocks = [sourceBlock];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock) break;
    for (const edge of currentBlock.successors) {
      if (edge.to === targetBlock) return true;
      if (visitedBlocks.has(edge.to)) continue;
      visitedBlocks.add(edge.to);
      pendingBlocks.push(edge.to);
    }
  }
  return false;
};

const canExecuteAfter = (
  earlierCall: EsTreeNode,
  laterCall: EsTreeNode,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  const ownerControlFlow = context.cfg.cfgFor(owner);
  const earlierBlock = ownerControlFlow?.blockOf(earlierCall);
  const laterBlock = ownerControlFlow?.blockOf(laterCall);
  if (!earlierBlock || !laterBlock) return false;
  return canReachBlock(earlierBlock, laterBlock);
};

const hasUnmountBetween = (
  owner: EsTreeNode,
  earlierCall: EsTreeNode,
  laterCall: EsTreeNode,
  context: RuleContext,
): boolean => {
  let hasUnmount = false;
  walkAst(owner, (descendantNode) => {
    if (
      isNodeOfType(descendantNode, "CallExpression") &&
      descendantNode.range[0] > earlierCall.range[1] &&
      descendantNode.range[1] < laterCall.range[0] &&
      context.cfg.enclosingFunction(descendantNode) === owner &&
      isNodeOfType(descendantNode.callee, "MemberExpression") &&
      getStaticPropertyName(descendantNode.callee) === "unmount"
    ) {
      hasUnmount = true;
    }
  });
  return hasUnmount;
};

export const inkNoRepeatedRender = defineRule({
  id: "ink-no-repeated-render",
  title: "Ink rendered repeatedly to one process",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.base,
  recommendation: "Call Ink `render()` once and update or rerender the returned instance.",
  create: (context) => {
    const renderCallsByOwner = new Map<EsTreeNode, EsTreeNodeOfType<"CallExpression">[]>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (resolveInkApiName(node.callee, context.scopes) !== "render") return;
        const owner = context.cfg.enclosingFunction(node);
        if (!owner) return;
        const previousRenderCalls = renderCallsByOwner.get(owner) ?? [];
        renderCallsByOwner.set(owner, [...previousRenderCalls, node]);
        if (
          !previousRenderCalls.some(
            (call) =>
              canExecuteAfter(call, node, owner, context) &&
              !hasUnmountBetween(owner, call, node, context),
          )
        ) {
          return;
        }
        context.report({
          node,
          message:
            "A second Ink `render()` call can create competing renderers for the same output.",
        });
      },
    };
  },
});
