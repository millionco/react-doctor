import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import type { BasicBlock } from "../../semantic/control-flow-graph.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isProcessStdoutMember } from "../../utils/is-process-stdout-member.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveInkApiName } from "../../utils/resolve-ink-api-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

interface InkRenderOutput {
  expression: EsTreeNode | null;
  isDefault: boolean;
}

interface InkRenderCleanupBindings {
  instanceSymbolIds: Set<number>;
  unmountSymbolIds: Set<number>;
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
    leftOutput.isDefault || isProcessStdoutMember(leftOutput.expression, context.scopes);
  const rightUsesProcessStdout =
    rightOutput.isDefault || isProcessStdoutMember(rightOutput.expression, context.scopes);
  if (leftUsesProcessStdout || rightUsesProcessStdout) {
    return leftUsesProcessStdout && rightUsesProcessStdout;
  }
  return areSameStableOutputBindings(leftOutput.expression, rightOutput.expression, context);
};

const canReachBlock = (
  sourceBlock: BasicBlock,
  targetBlock: BasicBlock,
  excludedBlocks: ReadonlySet<BasicBlock> = new Set(),
): boolean => {
  if (sourceBlock === targetBlock) return true;
  const visitedBlocks = new Set([sourceBlock]);
  const pendingBlocks = [sourceBlock];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock) break;
    for (const edge of currentBlock.successors) {
      if (excludedBlocks.has(edge.to)) continue;
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

const addBindingSymbolId = (
  bindingNode: EsTreeNode | null | undefined,
  symbolIds: Set<number>,
  context: RuleContext,
): void => {
  const identifier = isNodeOfType(bindingNode, "Identifier")
    ? bindingNode
    : isNodeOfType(bindingNode, "AssignmentPattern") && isNodeOfType(bindingNode.left, "Identifier")
      ? bindingNode.left
      : null;
  const symbol = identifier ? context.scopes.symbolFor(identifier) : null;
  if (symbol) symbolIds.add(symbol.id);
};

const collectRenderCleanupBindings = (
  renderCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): InkRenderCleanupBindings => {
  const bindings: InkRenderCleanupBindings = {
    instanceSymbolIds: new Set(),
    unmountSymbolIds: new Set(),
  };
  const parentNode = renderCall.parent;
  const bindingPattern =
    isNodeOfType(parentNode, "VariableDeclarator") && parentNode.init === renderCall
      ? parentNode.id
      : isNodeOfType(parentNode, "AssignmentExpression") && parentNode.right === renderCall
        ? parentNode.left
        : null;
  if (isNodeOfType(bindingPattern, "Identifier")) {
    addBindingSymbolId(bindingPattern, bindings.instanceSymbolIds, context);
    return bindings;
  }
  if (!isNodeOfType(bindingPattern, "ObjectPattern")) return bindings;
  for (const propertyNode of bindingPattern.properties) {
    if (
      isNodeOfType(propertyNode, "Property") &&
      getStaticPropertyKeyName(propertyNode, { allowComputedString: true }) === "unmount"
    ) {
      addBindingSymbolId(propertyNode.value, bindings.unmountSymbolIds, context);
    }
  }
  return bindings;
};

const isRenderUnmountCall = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  renderCall: EsTreeNodeOfType<"CallExpression">,
  bindings: InkRenderCleanupBindings,
  context: RuleContext,
): boolean => {
  const calleeNode = callNode.callee;
  if (isNodeOfType(calleeNode, "Identifier")) {
    const symbol = context.scopes.symbolFor(calleeNode);
    return Boolean(symbol && bindings.unmountSymbolIds.has(symbol.id));
  }
  if (
    !isNodeOfType(calleeNode, "MemberExpression") ||
    getStaticPropertyName(calleeNode) !== "unmount"
  ) {
    return false;
  }
  if (calleeNode.object === renderCall) return true;
  if (!isNodeOfType(calleeNode.object, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(calleeNode.object);
  return Boolean(symbol && bindings.instanceSymbolIds.has(symbol.id));
};

const isRenderUnmountedBefore = (
  owner: EsTreeNode,
  earlierCall: EsTreeNodeOfType<"CallExpression">,
  laterCall: EsTreeNode,
  context: RuleContext,
): boolean => {
  const bindings = collectRenderCleanupBindings(earlierCall, context);
  const cleanupCalls: EsTreeNodeOfType<"CallExpression">[] = [];
  walkAst(owner, (descendantNode) => {
    if (
      isNodeOfType(descendantNode, "CallExpression") &&
      descendantNode.range[1] > earlierCall.range[1] &&
      descendantNode.range[1] < laterCall.range[0] &&
      context.cfg.enclosingFunction(descendantNode) === owner &&
      isRenderUnmountCall(descendantNode, earlierCall, bindings, context)
    ) {
      cleanupCalls.push(descendantNode);
    }
  });
  if (cleanupCalls.length === 0) return false;
  const ownerControlFlow = context.cfg.cfgFor(owner);
  if (!ownerControlFlow) return false;
  const earlierBlock = ownerControlFlow.blockOf(earlierCall);
  const laterBlock = ownerControlFlow.blockOf(laterCall);
  if (!earlierBlock || !laterBlock) return false;
  const cleanupBlocks = new Set<BasicBlock>();
  for (const cleanupCall of cleanupCalls) {
    const cleanupBlock = ownerControlFlow.blockOf(cleanupCall);
    if (!cleanupBlock) continue;
    if (cleanupBlock === earlierBlock || cleanupBlock === laterBlock) return true;
    cleanupBlocks.add(cleanupBlock);
  }
  return !canReachBlock(earlierBlock, laterBlock, cleanupBlocks);
};

export const inkNoRepeatedRender = defineRule({
  id: "ink-no-repeated-render",
  title: "Ink render reused before unmount",
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
        const previousRenderCalls = renderCallsByOwner.get(owner);
        const didRenderBeforeUnmount = Boolean(
          previousRenderCalls?.some(
            (call) =>
              doInkRenderCallsShareOutput(call, node, context) &&
              canExecuteAfter(call, node, owner, context) &&
              !isRenderUnmountedBefore(owner, call, node, context),
          ),
        );
        if (previousRenderCalls) previousRenderCalls.push(node);
        else renderCallsByOwner.set(owner, [node]);
        if (!didRenderBeforeUnmount) {
          return;
        }
        context.report({
          node,
          message:
            "Ink reuses the existing output instance and ignores fresh renderer options; use its `rerender()` method or unmount it first.",
        });
      },
    };
  },
});
