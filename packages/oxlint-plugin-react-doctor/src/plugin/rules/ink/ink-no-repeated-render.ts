import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import type { BasicBlock } from "../../semantic/control-flow-graph.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "../../utils/is-proven-global-namespace-reference.js";
import { resolveInkApiName } from "../../utils/resolve-ink-api-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

interface InkRenderOutput {
  expression: EsTreeNode | null;
  isDefault: boolean;
}

const resolveInkRenderOutput = (
  renderCall: EsTreeNodeOfType<"CallExpression">,
): InkRenderOutput | null => {
  const optionsNode = renderCall.arguments[1];
  if (!optionsNode) return { expression: null, isDefault: true };
  if (!isNodeOfType(optionsNode, "ObjectExpression")) return null;

  let output: InkRenderOutput | null = { expression: null, isDefault: true };
  for (const propertyNode of optionsNode.properties) {
    if (isNodeOfType(propertyNode, "SpreadElement")) {
      output = null;
      continue;
    }
    if (!isNodeOfType(propertyNode, "Property")) continue;
    const propertyName = getStaticPropertyKeyName(propertyNode, {
      allowComputedString: true,
    });
    if (propertyName === null) {
      if (propertyNode.computed) output = null;
      continue;
    }
    if (propertyName !== "stdout") continue;
    output = { expression: propertyNode.value, isDefault: false };
  }
  return output;
};

const isProcessStdoutExpression = (node: EsTreeNode | null, context: RuleContext): boolean =>
  Boolean(
    node &&
    isNodeOfType(node, "MemberExpression") &&
    getStaticPropertyName(node) === "stdout" &&
    isProvenGlobalNamespaceReference(node.object, "process", context.scopes),
  );

const areSameStableOutputBindings = (
  leftNode: EsTreeNode | null,
  rightNode: EsTreeNode | null,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(leftNode, "Identifier") || !isNodeOfType(rightNode, "Identifier")) {
    return false;
  }
  const leftSymbol = context.scopes.symbolFor(leftNode);
  const rightSymbol = context.scopes.symbolFor(rightNode);
  return Boolean(
    leftSymbol &&
    leftSymbol.id === rightSymbol?.id &&
    leftSymbol.references.every((reference) => reference.flag === "read"),
  );
};

const doInkRenderCallsShareOutput = (
  leftCall: EsTreeNodeOfType<"CallExpression">,
  rightCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const leftOutput = resolveInkRenderOutput(leftCall);
  const rightOutput = resolveInkRenderOutput(rightCall);
  if (!leftOutput || !rightOutput) return false;
  const leftUsesProcessStdout =
    leftOutput.isDefault || isProcessStdoutExpression(leftOutput.expression, context);
  const rightUsesProcessStdout =
    rightOutput.isDefault || isProcessStdoutExpression(rightOutput.expression, context);
  if (leftUsesProcessStdout || rightUsesProcessStdout) {
    return leftUsesProcessStdout && rightUsesProcessStdout;
  }
  return areSameStableOutputBindings(leftOutput.expression, rightOutput.expression, context);
};

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
              doInkRenderCallsShareOutput(call, node, context) &&
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
